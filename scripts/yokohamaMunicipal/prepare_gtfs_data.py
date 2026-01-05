import requests
import csv
import pickle
import datetime
import boto3
from google.transit import gtfs_realtime_pb2
import time
import io
import zipfile
import shutil
import os
import sys
import unicodedata
import jaconv

ACCESS_TOKEN = os.environ.get('ODPT_ACCESS_TOKEN', '')
path = os.path.dirname(__file__)

# GTFS static ファイルパス
S3_PREFIX_DATA = path + '/gtfs_data/'
S3_INDEX_PATH = path + '/cache/stop_index.pkl'
LOCAL_INDEX_PATH = path + '/cache/index.pkl'
CALENDAR_PATH = path + '/gtfs_data/calendar.txt'
STOP_TIMES_PATH = path + '/gtfs_data/stop_times.txt'
LAST_RECORDED_PATH = path + '/cache/last_recorded.pkl'
TRIP_END_TIMES_PATH = path + '/cache/trip_end_times.pkl'

STOP_SEQUENCE_PATH = path + '/cache/stop_sequence.pkl'

# S3 Pickle ユーティリティ
def load_pickle(path):
    with open(path, 'r') as f:
        return pickle.loads(f.read())

def save_pickle(data, path):
    body = pickle.dumps(data)

    with open(path, 'wb') as f:
        f.write(body)

def build_trip_end_times(path=STOP_TIMES_PATH):
    trip_end_times = {}
    with open(path, 'r', encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for row in reader:
            try:
                trip_id = row['trip_id']
                h, m, s = map(int, row['departure_time'].split(':'))

                # 24:xx:xx や 25:xx:xx などを許容（GTFS拡張仕様）
                total_sec = h * 3600 + m * 60 + s
                if trip_id not in trip_end_times or total_sec > trip_end_times[trip_id]:
                    trip_end_times[trip_id] = total_sec
            except (ValueError, KeyError):
                continue  # 不正な行はスキップ
        return trip_end_times

# ==== 停留所検索のインデックス作成 =====
def normalize(text):
    if not text:
        return ''
    text = unicodedata.normalize('NFKC', text)  # 全角→半角
    text = text.replace('ヶ', 'ケ').replace('ケ', 'ヶ')  # どちらも考慮
    return text.lower()

def download_csv(file_name):
    with open(S3_PREFIX_DATA + file_name, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))
    
# 辞書を構築しS3へ保存
def build_and_upload_index():
    stops = download_csv('stops.txt')
    stop_times = download_csv('stop_times.txt')
    trips = download_csv('trips.txt')
    routes = download_csv('routes.txt')
    translations = download_csv('translations.txt')

    stop_name_map = {}  # normalized name → set of stop_ids
    stop_name_kana_map = {}  # normalized name → set of stop_ids
    stop_id_to_name = {}
    stop_id_to_trips = {}  # stop_id → set of trip_id
    trip_id_to_info = {}   # trip_id → (route_id, stop_headsign)
    route_id_to_name = {}  # route_id → route_long_name
    trip_id_to_last_stop = {}  # ★ trip_id → last stop_id
    route_id_and_stop_sequence_to_stop_name = {}

    stop_id_to_location = {}

    # --- stops.txt 読み込み ---
    for stop in stops:
        stop_id = stop['stop_id']
        name = stop['stop_name']
        norm = normalize(name)
        stop_name_map.setdefault(norm, set()).add(stop_id)
        stop_id_to_name[stop_id] = name

        stop_id_to_location[stop_id] = {
            'lat': stop['stop_lat'],
            'lon': stop['stop_lon']
        }

        # かな
        for translation in translations:
            if translation['language'] == 'ja-Hrkt' and translation['field_value'] == name:
                norm = normalize(translation['translation'])
                stop_name_kana_map.setdefault(norm, set()).add(stop_id)

    # --- stop_times.txt を trip_id → stop_sequence でマッピング ---
    trip_stop_sequences = {}
    for row in stop_times:
        trip_id = row['trip_id']
        stop_id = row['stop_id']
        seq = int(row.get('stop_sequence', 0))
        trip_stop_sequences.setdefault(trip_id, []).append((seq, stop_id))

    for trip_id, stops_seq in trip_stop_sequences.items():
        sorted_stops = sorted(stops_seq)
        last_stop_id = sorted_stops[-1][1]  # ★ 最終 stop_id
        trip_id_to_last_stop[trip_id] = last_stop_id
        
        route_id_and_stop_sequence_to_stop_name[trip_id] = {}

        for stop in sorted_stops:
            route_id_and_stop_sequence_to_stop_name[trip_id][stop[0]] = stop_id_to_name[stop[1]]

        for _, stop_id in sorted_stops:
            # stop_id → trip_id の関連付け（終着かどうかは後でフィルタ）
            stop_id_to_trips.setdefault(stop_id, set()).add(trip_id)

    # --- trips.txt ---
    for trip in trips:
        trip_id = trip['trip_id']
        trip_id_to_info[trip_id] = (trip['route_id'], trip.get('trip_headsign', ''))

    # --- routes.txt ---
    for route in routes:
        route_id = route['route_id']
        if route.get('route_long_name', ''):
            route_id_to_name[route_id] = route.get('route_long_name', '').lstrip('0')
        else:
            route_id_to_name[route_id] = route.get('route_short_name', '').lstrip('0')

    # ★ stop_id_to_trips をフィルタ（終着は除外）
    for stop_id in list(stop_id_to_trips.keys()):
        filtered_trips = {
            tid for tid in stop_id_to_trips[stop_id]
            if trip_id_to_last_stop.get(tid) != stop_id
        }
        stop_id_to_trips[stop_id] = filtered_trips

    index_data = (
        stop_name_map,
        stop_name_kana_map,
        stop_id_to_name,
        stop_id_to_trips,
        trip_id_to_info,
        route_id_to_name,
        stop_id_to_location
    )

    with open(LOCAL_INDEX_PATH, 'wb') as f:
        pickle.dump(index_data, f)

    with open(STOP_SEQUENCE_PATH, 'wb') as f:
        pickle.dump(route_id_and_stop_sequence_to_stop_name, f)

    return index_data

## ==== 1日のデータ初期化 ====
def reset():
    last_recorded = set()
    save_pickle(last_recorded, LAST_RECORDED_PATH)

def init():
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    date_str = now.strftime('%Y%m%d')

    endpoint = 'https://api.odpt.org/api/v4/files/odpt/YokohamaMunicipal/Bus.zip?date=' + date_str + '&acl:consumerKey=' + ACCESS_TOKEN

    data = requests.get(endpoint)

    # 新しいGTFSデータがある
    if data.status_code == 200:
        zipped_gtfs_data = data.content
        bytes_io = io.BytesIO(zipped_gtfs_data)
        zip = zipfile.ZipFile(bytes_io)
        zip.extractall(path + '/gtfs_data')

        build_and_upload_index()

    trip_end_times = build_trip_end_times(STOP_TIMES_PATH)
    with open(TRIP_END_TIMES_PATH, 'wb') as f:
        pickle.dump(trip_end_times, f)
        

    # 重複記録の防止用セット
    reset()

    print('done!')