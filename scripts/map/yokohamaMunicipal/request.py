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

RT_DATA_KEY = path + '/cache/location.json'
ROUTE_DATA_KEY = path + '/cache/rotes.json'
POLE_DATA_KEY = path + '/cache/poles.json'

ACCESS_TOKEN = os.environ.get('ODPT_ACCESS_TOKEN', '')

API_ENDPOINT = 'https://api.odpt.org/api/v4/odpt:Bus?acl:consumerKey=' + ACCESS_TOKEN + '&odpt:operator=odpt.Operator:YokohamaMunicipal'

ROUTE_API_ENDPOINT = 'https://api.odpt.org/api/v4/odpt:BusroutePattern.json?acl:consumerKey=' + ACCESS_TOKEN

POLE_API_ENDPOINT = 'https://api.odpt.org/api/v4/odpt:BusstopPole?acl:consumerKey=' + ACCESS_TOKEN + '&odpt:operator=odpt.Operator:YokohamaMunicipal'

def main():
    response = requests.get(API_ENDPOINT)
    with open(RT_DATA_KEY, 'wb') as f:
        f.write(response.content)

def init():
    response = requests.get(ROUTE_API_ENDPOINT)
    with open(ROUTE_DATA_KEY, 'wb') as f:
        f.write(response.content)

    response = requests.get(POLE_API_ENDPOINT)
    with open(POLE_DATA_KEY, 'wb') as f:
        f.write(response.content)
