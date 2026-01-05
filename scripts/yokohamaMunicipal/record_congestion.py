import requests
import csv
import pickle
from datetime import datetime, timedelta
import boto3
from google.transit import gtfs_realtime_pb2
import time
import io
import os

path = os.path.dirname(__file__)

TRIP_END_TIMES_KEY = path + "/cache/trip_end_times.pkl"
LAST_RECORDED_KEY = path + "/cache/last_recorded.pkl"
GTFS_RT_DATA_KEY = path + '/cache/gtfs_rt'
TRIP_UPDATE_KEY = path + '/cache/trip_update'

# GTFS static ファイルパス
CALENDAR_KEY = path + "/gtfs_data/calendar.txt"
STOP_TIMES_KEY = path + "/gtfs_data/stop_times.txt"

ACCESS_TOKEN = os.environ.get('ODPT_ACCESS_TOKEN', '')

API_ENDPOINT = 'https://api.odpt.org/api/v4/gtfs/realtime/YokohamaMunicipalBus_vehicle?acl:consumerKey=' + ACCESS_TOKEN
TRIP_UPDATE_API_ENDPOINT = 'https://api.odpt.org/api/v4/gtfs/realtime/YokohamaMunicipalBus_trip_update?acl:consumerKey=' + ACCESS_TOKEN

# DynamoDB 初期化
dynamodb = boto3.resource('dynamodb', region_name='ap-northeast-1')  # 東京リージョン
table = dynamodb.Table('BusCongestion')

# 重複記録の防止用セット
last_recorded = set()

# occupancy_status を 0〜6 の数値にマッピング
OCCUPANCY_MAP = {
    "EMPTY": 0,
    "MANY_SEATS_AVAILABLE": 1,
    "FEW_SEATS_AVAILABLE": 2,
    "STANDING_ROOM_ONLY": 3,
    "CRUSHED_STANDING_ROOM_ONLY": 4,
    "FULL": 5,
    "NOT_ACCEPTING_PASSENGERS": 6,
}

# S3 Pickle ユーティリティ
def load_pickle_from_s3(key):
    with open(key, 'rb') as f:
        return pickle.loads(f.read())

def save_pickle(data, path):
    body = pickle.dumps(data)

    with open(path, 'wb') as f:
        f.write(body)

def save_data_to_s3(data, key):
    with open(key, 'wb') as f:
        f.write(data)


def load_service_ids_for_today():
    today = datetime.now().date()
    weekday = today.strftime('%A').lower()
    service_ids = set()

    f = open(CALENDAR_KEY)
    reader = csv.DictReader(f.read())
    f.close()

    for row in reader:
        try:
            start = datetime.strptime(row['start_date'], "%Y%m%d").date()
            end = datetime.strptime(row['end_date'], "%Y%m%d").date()
            if start <= today <= end and row.get(weekday) == '1':
                service_ids.add(row['service_id'])
        except (ValueError, KeyError):
            continue  # スキップして安全に続行
    return service_ids

def build_trip_end_times(key=STOP_TIMES_KEY):
    trip_end_times = {}

    f = open(key, encoding='utf-8')
    reader = csv.DictReader(f)

    for row in reader:
        try:
            trip_id = row['trip_id']
            h, m, s = map(int, row['departure_time'].split(":"))

            # 24:xx:xx や 25:xx:xx などを許容（GTFS拡張仕様）
            total_sec = h * 3600 + m * 60 + s
            if trip_id not in trip_end_times or total_sec > trip_end_times[trip_id]:
                trip_end_times[trip_id] = total_sec
        except (ValueError, KeyError):
            continue  # 不正な行はスキップ

    f.close()

    return trip_end_times

def get_current_seconds():
    now = datetime.utcnow() + timedelta(hours=9)
    return now.hour * 3600 + now.minute * 60 + now.second

def is_trip_operating(trip_id, trip_end_times):
    """trip_id がまだ運行中かを判定（end_time > 現在時刻）"""
    end_time = trip_end_times.get(trip_id, 0)
    return get_current_seconds() <= end_time

def record_congestion(trip_id, stop_sequence, occupancy_status, last_recorded):
    if (trip_id, stop_sequence) in last_recorded:
        return

    # occ = str(occupancy_status).split('.')[-1]
    # congestion_value = OCCUPANCY_MAP.get(occ, None)
    congestion_value = occupancy_status
    if congestion_value is None:
        return

    key = {'trip_id': trip_id, 'stop_sequence': int(stop_sequence)}
    response = table.get_item(Key=key)

    if 'Item' in response:
        item = response['Item']
        new_sum = item['congestion_sum'] + congestion_value
        new_count = item['count'] + 1
    else:
        new_sum = congestion_value
        new_count = 1

    ttl = datetime.utcnow() + timedelta(days=30)

    table.put_item(Item={
        'trip_id': trip_id,
        'stop_sequence': int(stop_sequence),
        'congestion_sum': new_sum,
        'count': new_count,
        'last_updated': datetime.utcnow().isoformat(),
        'time_to_live': int(ttl.timestamp())
    })

    last_recorded.add((trip_id, stop_sequence))

def main():
    service_ids = load_service_ids_for_today()
    trip_end_times = load_pickle_from_s3(TRIP_END_TIMES_KEY)
    last_recorded = set(load_pickle_from_s3(LAST_RECORDED_KEY))

    response = requests.get(API_ENDPOINT)
    save_data_to_s3(response.content, GTFS_RT_DATA_KEY)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    for entity in feed.entity:
        if entity.HasField('vehicle'):
            vehicle = entity.vehicle

            if vehicle.trip.trip_id and vehicle.current_stop_sequence:
                trip_id = vehicle.trip.trip_id
                stop_seq = vehicle.current_stop_sequence

                if vehicle.current_status == vehicle.STOPPED_AT:
                    continue

                if not is_trip_operating(trip_id, trip_end_times):
                    continue

                record_congestion(trip_id, stop_seq, vehicle.occupancy_status, last_recorded)

    # 3. 記録済みセットを更新
    save_pickle(last_recorded, LAST_RECORDED_KEY)

    response = requests.get(TRIP_UPDATE_API_ENDPOINT)
    save_data_to_s3(response.content, TRIP_UPDATE_KEY)

def init():
    trip_end_times = build_trip_end_times(STOP_TIMES_KEY)
    with open(TRIP_END_TIMES_KEY, "wb") as f:
        pickle.dump(trip_end_times, f)

def reset():
    last_recorded = set()
    save_pickle(last_recorded, LAST_RECORDED_KEY)
