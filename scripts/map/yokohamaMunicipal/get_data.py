import requests
import csv
import pickle
from datetime import datetime, timedelta
import boto3
from google.transit import gtfs_realtime_pb2
import time
import io
import os
import json

path = os.path.dirname(__file__)

ACCESS_TOKEN = os.environ.get('ODPT_ACCESS_TOKEN', '')

RT_DATA_KEY = path + '/cache/location.json'
ROUTE_DATA_KEY = path + '/cache/rotes.json'
POLE_DATA_KEY = path + '/cache/poles.json'

def load_file(key):
    with open(key, 'r') as f:
        return f.read()
    
def get_route():
    response = load_file(ROUTE_DATA_KEY)
    return json.loads(response)

def get_location():
    response = load_file(RT_DATA_KEY)
    return json.loads(response)

def get_poles():
    response = load_file(POLE_DATA_KEY)
    return json.loads(response)

def get_route_information(id):
    url = 'https://api.odpt.org/api/v4/odpt:BusroutePattern?acl:consumerKey=' + ACCESS_TOKEN + '&owl:sameAs=' + id
    response = requests.get(url)
    return json.loads(response.content)
