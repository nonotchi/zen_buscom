import csv
import datetime
import boto3
import json
import os

path = os.path.dirname(__file__)

S3_PREFIX_DATA = path + '/gtfs_data/'
STOP_TIMES_PATH = "stop_times.txt"
CALENDAR_PATH = "calendar.txt"
CALENDAR_DATES_PATH = "calendar_dates.txt"
TRIPS_PATH = "trips.txt"

# DynamoDB 初期化
REGION = 'ap-northeast-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table = dynamodb.Table('BusCongestion')

def download_csv(file_name):
    with open(S3_PREFIX_DATA + file_name, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

def get_average_congestion(trip_id, stop_sequence):
    response = table.get_item(
        Key={
            'trip_id': trip_id,
            'stop_sequence': stop_sequence
        }
    )
    if 'Item' in response and response['Item']['count'] > 0:
        item = response['Item']
        average = item['congestion_sum'] / item['count']
        return round(average, 2)
    else:
        return None

def get_service_ids(year, month, date):
    """calendar.txt + calendar_dates.txt から、今日有効な service_id を取得"""
    date = datetime.datetime(year, month, date)
    date_str = date.strftime("%Y%m%d")
    weekday = date.strftime("%A").lower()

    valid_services = set()

    # calendar.txt
    calendar = download_csv(CALENDAR_PATH)

    for row in calendar:
        start = datetime.datetime.strptime(row['start_date'], "%Y%m%d")
        end = datetime.datetime.strptime(row['end_date'], "%Y%m%d")
        if start <= date <= end and row[weekday] == '1':
            valid_services.add(row['service_id'])

    # calendar_dates.txt（例外を追加または除外）
    try:
        calendar_dates = download_csv(CALENDAR_DATES_PATH)
        for row in calendar_dates:
            if row['date'] == date_str:
                if row['exception_type'] == '1':
                    valid_services.add(row['service_id'])
                elif row['exception_type'] == '2':
                    valid_services.discard(row['service_id'])
    except FileNotFoundError:
        pass  # calendar_dates.txt が存在しない場合もOK

    return valid_services

def build_trip_info(service_ids):
    trip_info = {}

    trips = download_csv(TRIPS_PATH)
    for row in trips:
        if row['service_id'] in service_ids:
            trip_info[row['trip_id']] = {
                'route_id': row['route_id'],
                'trip_headsign': row['trip_headsign']
            }
    return trip_info

def get_departures_at_stop(target_stop_id, year, month, date):
    service_ids = get_service_ids(year, month, date)
    trip_info = build_trip_info(service_ids)
    results = []

    stop_times = download_csv(STOP_TIMES_PATH)
    routes = download_csv('routes.txt')

    stop_sequence_count = {}

    for row in stop_times:
        pickup_type = row.get('pickup_type', '0').strip()
        
        if pickup_type != '' and pickup_type != '0':
            continue
            
        trip_id = row['trip_id']
        stop_id = row['stop_id']

        if trip_id not in stop_sequence_count:
            stop_sequence_count[trip_id] = 0

        if stop_sequence_count[trip_id] < int(row['stop_sequence']):
            stop_sequence_count[trip_id] = int(row['stop_sequence'])

        if stop_id == target_stop_id and trip_id in trip_info:
            results.append({
                'trip_id': trip_id,
                'stop_sequence': int(row['stop_sequence']),
                'departure_time': row['departure_time'],
                'route_id': trip_info[trip_id]['route_id'],
                'trip_headsign': row['stop_headsign'],
                'should_ignore': False
            })

    # 終着は無視
    for item in results:
        if item['stop_sequence'] == stop_sequence_count[item['trip_id']]:
            item['should_ignore'] = True

    for route in routes:
        route_id = route['route_id']

        for result in results:
            if result['route_id'] == route_id:
                result['route_name'] = route.get('route_short_name', '').lstrip('0')

    # 時刻順にソート
    results.sort(key=lambda x: x['departure_time'])
    return results

def batch_get_congestion(trip_stop_pairs):
    keys = [{'trip_id': tid, 'stop_sequence': seq} for tid, seq in trip_stop_pairs]
    result_map = {}
    # DynamoDBのBatchGetItemは最大100件
    for i in range(0, len(keys), 100):
        batch_keys = keys[i:i+100]
        response = dynamodb.batch_get_item(
            RequestItems={
                'BusCongestion': {
                    'Keys': batch_keys
                }
            }
        )
        for item in response['Responses'].get('BusCongestion', []):
            key = (item['trip_id'], item['stop_sequence'])
            if item['count'] > 0:
                avg = item['congestion_sum'] / item['count']
                result_map[key] = round(avg, 2)
    return result_map


def get(target_stop_id):
    # year = int(body['year'])
    # month = int(body['month'])
    # date = int(body['date'])

    now = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    year = now.year
    month = now.month
    date = now.day

    departures = get_departures_at_stop(target_stop_id, year, month, date)

    result = []

    trip_stop_keys = [(dep['trip_id'], dep['stop_sequence']) for dep in departures]
    congestion_map = batch_get_congestion(trip_stop_keys)

    for dep in departures:
        if dep['should_ignore'] == True:
            continue

        congestion = congestion_map.get((dep['trip_id'], dep['stop_sequence']), -2)
        result.append({
            'trip_id': dep['trip_id'],
            'stop_sequence': dep['stop_sequence'],
            'departure_time': dep['departure_time'][:5],
            'route_name': dep['route_name'],
            'destination': dep['trip_headsign'],
            'congestion': float(congestion)
        })

    return json.dumps(result, ensure_ascii=False)
