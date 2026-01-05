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

API_ENDPOINT = 'https://api.odpt.org/api/v4/gtfs/realtime/odpt_KawasakiTsurumiRinkoBus_allrinko_vehicle?acl:consumerKey=' + ACCESS_TOKEN
TRIP_UPDATE_API_ENDPOINT = 'https://api.odpt.org/api/v4/gtfs/realtime/odpt_KawasakiTsurumiRinkoBus_allrinko_trip_update?acl:consumerKey=' + ACCESS_TOKEN
# DynamoDB 初期化
dynamodb = boto3.resource('dynamodb', region_name='ap-northeast-1')  # 東京リージョン
table = dynamodb.Table('BusCongestion')

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

def main():
    response = requests.get(API_ENDPOINT)
    save_data_to_s3(response.content, GTFS_RT_DATA_KEY)
    response = requests.get(TRIP_UPDATE_API_ENDPOINT)
    save_data_to_s3(response.content, TRIP_UPDATE_KEY)
