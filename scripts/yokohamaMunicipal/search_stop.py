import boto3
import csv
import pickle
import unicodedata
import re
from botocore.exceptions import ClientError
import json
import os
import sys
import jaconv

path = os.path.dirname(__file__)

S3_PREFIX_DATA = path + '/gtfs_data/'
S3_INDEX_PATH = path + '/cache/stop_index.pkl'
LOCAL_INDEX_PATH = path + '/cache/index.pkl'

STOP_SEQUENCE_PATH = path + '/cache/stop_sequence.pkl'

# 正規化処理（表記ゆれ対応）
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

# S3から辞書を読み込み（存在しなければ構築）
def load_index():
    try:
        with open(LOCAL_INDEX_PATH, 'rb') as f:
            return pickle.load(f)
    except FileNotFoundError as e:
        print("辞書が存在しないか読み込み失敗:", e)
        return build_and_upload_index()

# 検索処理
def search_stop(query):
    norm_query = normalize(query)
    (
        stop_name_map, stop_name_kana_map, stop_id_to_name,
        stop_id_to_trips, trip_id_to_info,
        route_id_to_name, stop_id_to_location
    ) = load_index()

    matched_ids = set()
    for name_norm, ids in stop_name_map.items():
        if norm_query in name_norm:
            matched_ids.update(ids)

    for name_kana_norm, ids in stop_name_kana_map.items():
        if jaconv.hira2kata(norm_query) in name_kana_norm:
            matched_ids.update(ids)

    result = []
    for stop_id in matched_ids:
        stop_name = stop_id_to_name.get(stop_id, '')
        trips = stop_id_to_trips.get(stop_id, set())
        location = stop_id_to_location.get(stop_id, [None, None])
        route_headsigns = set()
        for trip_id in trips:
            route_id, headsign = trip_id_to_info.get(trip_id, ('', ''))
            route_name = route_id_to_name.get(route_id, route_id)
            route_headsigns.add((route_name, headsign))

        if len(route_headsigns) > 0:
            result.append({
                'stop_id': stop_id,
                'stop_name': stop_name,
                'lat': location['lat'],
                'lon': location['lon'],
                'routes': list(route_headsigns)
            })

    return result

def search(query):
    if not query:
        sys.exit()

    results = search_stop(query)
    return json.dumps(results, ensure_ascii=False)
