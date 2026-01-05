from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import yokohamaMunicipal.search_stop
import yokohamaMunicipal.get_departures
import yokohamaMunicipal.get_realtime_data

import rinkoBus.search_stop
import rinkoBus.get_departures
import rinkoBus.get_realtime_data

import toBus.search_stop
import toBus.get_departures
import toBus.get_realtime_data

import map.yokohamaMunicipal.get_data

import time
from datetime import datetime, date

class Req(BaseModel):
    trips: list
    id: str
    
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['https://buscom.jp/'],
    allow_credentials=True,
    allow_methods=['GET', 'POST'],
    allow_headers=['Content-Type', 'Authorization', 'Access-Control-Allow-Origin'],
)

@app.get("/yokohamaMunicipal/search")
def search(query):
    return yokohamaMunicipal.search_stop.search(query)

@app.get("/yokohamaMunicipal/get_departures")
def get(id):
    return yokohamaMunicipal.get_departures.get(id)

@app.post("/yokohamaMunicipal/get_rt_data")
def rt(req: Req):
    return yokohamaMunicipal.get_realtime_data.get(req)

@app.get("/rinkoBus/search")
def search(query):
    return rinkoBus.search_stop.search(query)

@app.get("/rinkoBus/get_departures")
def get(id):
    return rinkoBus.get_departures.get(id)

@app.post("/rinkoBus/get_rt_data")
def rt(req: Req):
    return rinkoBus.get_realtime_data.get(req)

@app.get("/toBus/search")
def search(query):
    return toBus.search_stop.search(query)

@app.get("/toBus/get_departures")
def get(id):
    return toBus.get_departures.get(id)

@app.post("/toBus/get_rt_data")
def rt(req: Req):
    return toBus.get_realtime_data.get(req)

# マップ

@app.get("/map/yokohamaMunicipal/get_routes")
def get_routes():
    return map.yokohamaMunicipal.get_data.get_route()

@app.get("/map/yokohamaMunicipal/get_locations")
def get_locations():
    return map.yokohamaMunicipal.get_data.get_location()

@app.get("/map/yokohamaMunicipal/get_poles")
def get_poles():
    return map.yokohamaMunicipal.get_data.get_poles()

@app.get("/map/yokohamaMunicipal/get_route_information")
def get_route_info(id):
    return map.yokohamaMunicipal.get_data.get_route_information(id)