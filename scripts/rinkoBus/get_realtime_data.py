from google.transit import gtfs_realtime_pb2
import requests
import json
import boto3
import datetime
import os
import pickle

path = os.path.dirname(__file__)

GTFS_RT_DATA_KEY = path + '/cache/gtfs_rt'
TRIP_UPDATE_KEY = path + '/cache/trip_update'

STOP_SEQUENCE_PATH = path + '/cache/stop_sequence.pkl'

def load_stop_sequence():
    with open(STOP_SEQUENCE_PATH, 'rb') as f:
        return pickle.load(f)
    
def load_from_s3(key):
    with open(key, 'rb') as f:
        return f.read()

def get(event):
    trips = event.trips
    stop = event.id

    if not trips:
        return {'statusCode': 400, 'body': 'query parameter required'}

    response = load_from_s3(GTFS_RT_DATA_KEY)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response)

    stop_sequence = load_stop_sequence()

    result = {}

    for entity in feed.entity:
        if entity.HasField('vehicle'):
            vehicle = entity.vehicle
            trip = vehicle.trip.trip_id

            if trip in trips:
                vehicle_information = {}

                if vehicle.trip.trip_id and vehicle.current_stop_sequence:
                    vehicle_information['position'] = vehicle.current_stop_sequence
                    vehicle_information['position_name'] = stop_sequence[vehicle.trip.trip_id][vehicle.current_stop_sequence]

                if vehicle.occupancy_status is not None:
                    vehicle_information['congestion'] = vehicle.occupancy_status

                result[trip] = vehicle_information
    
    trip_update = load_from_s3(TRIP_UPDATE_KEY)
    feed.ParseFromString(trip_update)

    for entity in feed.entity:
        if entity.HasField('trip_update'):
            trip_id = entity.trip_update.trip.trip_id

            if trip_id in trips and trip_id in result:
                for stop_time_update in entity.trip_update.stop_time_update:
                    if stop_time_update.stop_id == stop:
                        dep_time = datetime.datetime.fromtimestamp(stop_time_update.departure.time) + datetime.timedelta(hours=9)

                        result[trip_id].update({'departure': dep_time.strftime('%H:%M')})

    return json.dumps(result, ensure_ascii=False)
