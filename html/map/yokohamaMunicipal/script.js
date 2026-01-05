/**
 * =================================================================
 * 定数定義
 * =================================================================
 */
// APIトークン（ご自身のものに置き換えてください）
const MAPBOX_API_TOKEN = 'pk.eyJ1Ijoibm9ub3RjaGkiLCJhIjoiY21nbjRtaXI1MWtjOTJrcjB0MW9mMTdzOCJ9.yvSuLaD-4C7y_nyPxzc3Bg';

// 対象のバス事業者ID
const OPERATOR_ID = 'odpt.Operator:YokohamaMunicipal';

// ODPT APIエンドポイント
const API_BASE_URL = 'https://buscom.jp/api/map/yokohamaMunicipal/';
const BUS_ROUTE_PATTERN_URL = `${API_BASE_URL}get_routes`;
const BUS_STOP_POLE_URL = `${API_BASE_URL}get_poles`;
const REALTIME_BUS_LOCATION_URL = `${API_BASE_URL}get_locations`;

let map = null;
let selectedRoute = null;
let lastRealtimeData = null;

/**
 * =================================================================
 * ユーティリティ関数
 * =================================================================
 */

/**
 * APIからデータを非同期で取得する汎用関数
 * @param {string} url - 取得先のURL
 * @returns {Promise<any>} - 取得したJSONデータ
 */
const fetchApiData = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API request failed with status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(error.message);
        return null; // エラー発生時はnullを返す
    }
};

/**
 * GeoJSON FeatureCollection を作成するヘルパー関数
 * @param {Array} coordinatesArray - 座標の配列
 * @param {'Point' | 'LineString'} geometryType - ジオメトリのタイプ
 * @returns {GeoJSON.FeatureCollection} - GeoJSON FeatureCollection オブジェクト
 */
const createGeoJsonFeatureCollection = (coordinatesArray, geometryType) => {
    const features = coordinatesArray.map(coords => {
        let congestion = -1;
        let properties = {};

        if ('congestion' in coords) {
            congestion = stringToCongestionLevel(coords['congestion']);
            
            properties['congestion'] = congestion;
        }
        
        if ('route' in coords) {
            properties['route'] = coords['route'];
        }

        if ('selected' in coords) {
            properties['selected'] = coords['selected'];
        }

        return {
            'type': 'Feature',
            'geometry': {
                'type': geometryType,
                'coordinates': coords['geo']
            },
            'properties': properties
        }
    });

    return {
        'type': 'FeatureCollection',
        'features': features
    };
};

const stringToCongestionLevel = (congestion) => {
    if (congestion === 'odpt.OccupancyStatus:Empty' || congestion === 'odpt.OccupancyStatus:ManySeatsAvailable') {
        return 1;
    } else if (congestion === 'odpt.OccupancyStatus:FewSeatsAvailable') {
        return 2;
    } else if (congestion === 'odpt.OccupancyStatus:StandingRoomOnly') {
        return 3;
    } else {
        return 4;
    }
}

/**
 * =================================================================
 * データ取得・整形関数
 * =================================================================
 */

/**
 * バスの路線形状データを取得し、GeoJSON形式で返す
 * @returns {Promise<GeoJSON.FeatureCollection | null>}
 */
const fetchBusRoutesGeoJson = async () => {
    const allRoutes = await fetchApiData(BUS_ROUTE_PATTERN_URL);
    if (!allRoutes) return null;

    const targetRoutesCoordinates = allRoutes
        .filter(route => route['odpt:operator'] === OPERATOR_ID)
        .map(route => (
            {
                'geo': route['ug:region']['coordinates'],
                'route': route['owl:sameAs'],
                'selected': 0
            }
        ));
    
    return createGeoJsonFeatureCollection(targetRoutesCoordinates, 'LineString');
};

/**
 * バスの停留所データを取得し、GeoJSON形式で返す
 * @returns {Promise<GeoJSON.FeatureCollection | null>}
 */
const fetchBusStopsGeoJson = async () => {
    const allStops = await fetchApiData(BUS_STOP_POLE_URL);
    if (!allStops) return null;

    const stopCoordinates = allStops.map(stop => (
        {'geo': [stop['geo:long'], stop['geo:lat']]}
    ));
    
    return createGeoJsonFeatureCollection(stopCoordinates, 'Point');
};

/**
 * リアルタイムのバス位置データを取得し、GeoJSONと更新間隔を返す
 * @returns {Promise<{busLocationsGeoJson: GeoJSON.FeatureCollection, updateInterval: number} | null>}
 */
const fetchRealtimeBusData = async () => {
    const realtimeData = await fetchApiData(REALTIME_BUS_LOCATION_URL);
    if (!realtimeData || realtimeData.length === 0) return null;

    const busCoordinates = realtimeData.map(bus => {
        // 終着
        if (bus['odpt:toBusstopPole'] === null) {
            return {
                'geo': [null, null],
                'congestion': null,
                'route': null
            };
        }

        return {
            'geo': [bus['geo:long'], bus['geo:lat']],
            'congestion': bus['odpt:occupancyStatus'],
            'route': bus['odpt:busroutePattern'],
            'date': bus['dc:date']
        };
    });
    const busLocationsGeoJson = createGeoJsonFeatureCollection(busCoordinates, 'Point');

    // 選択中の路線があれば、位置情報更新
    const sections = document.getElementsByClassName('detail-vehicle');
        
    for (let j = 0; j < sections.length; j++) {
        sections[j].innerHTML = '<div class="spacer"></div>';
    }

    for (let i = 0; i < realtimeData.length; i++) {
        if (realtimeData[i]['odpt:busroutePattern'] === selectedRoute) {
            const congestionStrings = ['空いています', '空いています', '混んでいます', '非常に混んでいます', '満員です', '満員です', '満員です'];
            const congestionLevel = stringToCongestionLevel(realtimeData[i]['odpt:occupancyStatus']);

            const targetSection = document.getElementById(realtimeData[i]['odpt:fromBusstopPole']);

            if (targetSection) {
                targetSection.innerHTML =
                    `<img src="https://buscom.jp/assets/congestion_${String(congestionLevel)}.png" alt="混雑度">
                    <div class="detail-congestion">${congestionStrings[congestionLevel]}</div>`;
            }

            // データ更新時刻の表示
            const date = new Date(realtimeData[i]['dc:date']);
            const dateString =
                `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}
                ${('00' + date.getHours()).slice(-2)}:${('00' + date.getMinutes()).slice(-2)}:${('00' + date.getSeconds()).slice(-2)}`;
            document.getElementById('detail-update').textContent = `データ生成時刻：${dateString}`;
        }
    }

    lastRealtimeData = realtimeData;
    
    return busLocationsGeoJson;
};


/**
 * =================================================================
 * 地図描画関連の関数
 * =================================================================
 */

/**
 * Mapboxの地図を初期化する
 * @returns {mapboxgl.Map}
 */
const initializeMap = () => {
    mapboxgl.accessToken = MAPBOX_API_TOKEN;
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [139.62202, 35.46631], // 横浜駅
        zoom: 15
    });

    // 地図の言語を日本語に設定
    map.addControl(new MapboxLanguage());
    return map;
};

/**
 * 地図にGeoJSONのソースとレイヤーを追加する
 * @param {mapboxgl.Map} map - MapboxのMapオブジェクト
 * @param {string} id - ソースとレイヤーのID
 * @param {GeoJSON.FeatureCollection} geoJsonData - 表示するGeoJSONデータ
 * @param {mapboxgl.AnyLayer} layerOptions - レイヤーのスタイル設定
 */
const addDataSourceAndLayer = (map, id, geoJsonData, layerOptions) => {
    map.addSource(id, {
        'type': 'geojson',
        'data': geoJsonData
    });
    map.addLayer({
        'id': id,
        'source': id,
        ...layerOptions
    });
};


/**
 * =================================================================
 * 路線描画
 * =================================================================
 */

const routeDetail = async (id) => {
    // 系統情報の取得
    const url = `${API_BASE_URL}get_route_information?id=${id}`;
    const routeInformation = await fetchApiData(url);
    if (!routeInformation) return null;

    const route = routeInformation[0]['dc:title'].replace(/^0+/, '');   // 先頭の0を除去
    const destination = routeInformation[0]['odpt:busstopPoleOrder'].at(-1)['odpt:note'];

    // 表示
    document.getElementById('detail-route-name').textContent = route;
    document.getElementById('detail-destination').textContent = `${destination} 行`;

    document.getElementById('bus-information-wrap').style.display = 'block';

    // 路線図の生成
    const motherElem = document.getElementById('detail-route');
    const stops = routeInformation[0]['odpt:busstopPoleOrder'];

    motherElem.innerHTML = '';

    for (let i = 0; i < stops.length; i++) {
        const stopElem = document.createElement('div');
        stopElem.setAttribute('class', 'detail-stop');
        stopElem.innerHTML = `<div class="detail-stop-name">${stops[i]['odpt:note']}</div>`;
        motherElem.appendChild(stopElem);

        if (i !== stops.length - 1) {
            const sectionElem = document.createElement('div');
            sectionElem.setAttribute('class', 'detail-section');
            sectionElem.innerHTML = `<div class="detail-vehicle" id="${stops[i]['odpt:busstopPole']}"><div class="spacer"></div></div>`;
            motherElem.appendChild(sectionElem);
        }
    }

    selectedRoute = id;

    // 最終取得リアルタイムデータから現在地を表示
    const sections = document.getElementsByClassName('detail-vehicle');
        
    for (let j = 0; j < sections.length; j++) {
        sections[j].innerHTML = '<div class="spacer"></div>';
    }

    for (let i = 0; i < lastRealtimeData.length; i++) {
        if (lastRealtimeData[i]['odpt:busroutePattern'] === selectedRoute) {
            const congestionStrings = ['空いています', '空いています', '混んでいます', '非常に混んでいます', '満員です', '満員です', '満員です'];
            const congestionLevel = stringToCongestionLevel(lastRealtimeData[i]['odpt:occupancyStatus']);

            const targetSection = document.getElementById(lastRealtimeData[i]['odpt:fromBusstopPole']);

            if (targetSection) {
                targetSection.innerHTML =
                    `<img src="https://buscom.jp/assets/congestion_${String(congestionLevel)}.png" alt="混雑度">
                    <div class="detail-congestion">${congestionStrings[congestionLevel]}</div>`;
            }

            // データ更新時刻の表示
            const date = new Date(lastRealtimeData[i]['dc:date']);
            const dateString =
                `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}
                ${('00' + date.getHours()).slice(-2)}:${('00' + date.getMinutes()).slice(-2)}:${('00' + date.getSeconds()).slice(-2)}`;
            document.getElementById('detail-update').textContent = `データ生成時刻：${dateString}`;
        }
    }

    // スマホの場合、モーダル形式で表示
    if (window.matchMedia && window.matchMedia('(max-device-width: 959px)').matches) {
        document.getElementById('detail').style.display = 'block';
    }
}


/**
 * =================================================================
 * 検索処理
 * =================================================================
 */

let searchResult = null;

let stopPopup = new mapboxgl.Popup();

const hideSuggest = () => {
    document.getElementById('suggest').style.display = 'none';
}

const goToStopPole = (e) => {
    hideSuggest();

    for (let i = 0; i < searchResult.length; i++) {
        if (`suggest-${searchResult[i].stop_id}` === e.target.id && map) {
            map.flyTo({
                center: [searchResult[i].lon, searchResult[i].lat],
            });

            let departures = '';
            for (let j = 0; j < searchResult[i].routes.length; j++) {
                departures += `<span class="route-name">${searchResult[i].routes[j][0]}</span>${searchResult[i].routes[j][1]}<br>`;
            }

            stopPopup
                .setLngLat([searchResult[i].lon, searchResult[i].lat])
                .setHTML(
                    `<strong>${searchResult[i].stop_name}</strong>・<a href="https://buscom.jp/yokohamaMunicipal/?id=${searchResult[i].stop_id}&name=${searchResult[i].stop_name}" target="_blank">発車案内</a>
                    <br>${departures}`
                )
                .addTo(map);
        }

        document.getElementById(`suggest-${searchResult[i].stop_id}`).removeEventListener('click', goToStopPole);
    }
}

const suggest = async () => {
    const query = document.getElementById('search-box').value;

    const url = `https://buscom.jp/api/yokohamaMunicipal/search?query=${encodeURIComponent(query)}`;
    const searchResultString = await fetchApiData(url);
    searchResult = JSON.parse(searchResultString);
    if (!searchResult) return null;

    const resultDom = document.getElementById('suggest');
    resultDom.style.display = 'block';
    resultDom.innerHTML = '';

    for (let i = 0; i < searchResult.length; i++) {
        let departures = new Array();
        for (let j = 0; j < searchResult[i].routes.length; j++) {
            departures.push(searchResult[i].routes[j][1]);
        }

        departures = [...new Set(departures)];

        let departuresHTML = '';
        for (let j = 0; j < departures.length; j++) {
            departuresHTML += departures[j];

            if (j !== departures.length - 1) {
                departuresHTML += ', ';
            }
        }

        const suggestElem = document.createElement('a');
        suggestElem.setAttribute('href', 'javascript:void(0);');
        suggestElem.setAttribute('id', `suggest-${searchResult[i].stop_id}`);
        suggestElem.addEventListener('click', goToStopPole);
        suggestElem.innerHTML =`<strong>${searchResult[i].stop_name}</strong><br>${departuresHTML}`;
        
        resultDom.appendChild(suggestElem);
    }
}

const addSuggestEvents = () => {
    document.getElementById('search').addEventListener('click', suggest);
    document.getElementById('search').addEventListener('focusout', () => {
        setTimeout(hideSuggest, 500);
    });
}


/**
 * =================================================================
 * メイン処理
 * =================================================================
 */
const main = async () => {
    map = initializeMap();
    let busRoutesGeoJson = {};
    let busStopsGeoJson = {};

    // スマホのモーダル閉じるボタン
    document.getElementById('sp-close-detail').addEventListener('click', () => {
        document.getElementById('detail').style.display = 'none';
    });

    addSuggestEvents();

    map.on('load', async () => {        
        // 路線と停留所のデータを並列で取得
        [busRoutesGeoJson, busStopsGeoJson] = await Promise.all([
            fetchBusRoutesGeoJson(),
            fetchBusStopsGeoJson()
        ]);
        
        // 路線レイヤーを追加
        if (busRoutesGeoJson) {
            addDataSourceAndLayer(map, 'route-lines', busRoutesGeoJson, {
                'type': 'line',
                'filter': ['!=', ['get', 'selected'], 1], // 💡 フィルターを追加: selectedが1ではないものだけを描画
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': {
                    'line-width': 1,        // デフォルトの太さに固定
                    'line-color': '#666666' // デフォルトの色に固定
                },
            });
        }
        
        // 停留所レイヤーを追加
        if (busStopsGeoJson) {
            addDataSourceAndLayer(map, 'bus-stops', busStopsGeoJson, {
                'type': 'circle',
                'paint': { 'circle-color': '#888888', 'circle-radius': 4 }
            });
        }

        // 強調用レイヤー
        map.addLayer({
            'id': 'highlight-route-line',
            'type': 'line',
            'source': 'route-lines', // データソースは既存のものと同じ
            'filter': ['==', ['get', 'selected'], 1], // 💡 フィルター: selectedが1のものだけを描画
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': {
                // 強調したいスタイルを直接設定
                'line-width': 5,
                'line-color': '#ff4b00' // 赤色で強調
            }
        }, 'bus-stops'); // 💡 'bus-stops'の前に追加して最前面付近に配置

        // 初回のバス位置データを取得・表示
        const initialBusData = await fetchRealtimeBusData();
        if (!initialBusData) return;

        let busLocationsGeoJson = initialBusData;
        
        addDataSourceAndLayer(map, 'bus-locations', busLocationsGeoJson, {
            'type': 'circle',
            'paint': {
                'circle-radius': 15,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1,

                'circle-color': [
                    'match',
                    ['get', 'congestion'], 
                    
                    1, '#005aff',   // 空いています
                    2, '#03af7a',   // 混んでいます
                    3, '#f6aa00',   // 非常に混んでいます
                    4, '#ff4b00',   // 満員です
                    
                    // デフォルト
                    '#808080' // グレー
                ]
            }
        });

        // 定期的にバスの位置を更新
        setInterval(async () => {
            const latestBusData = await fetchRealtimeBusData();
            if (latestBusData) {
                map.getSource('bus-locations').setData(latestBusData);
            }
        }, 15 * 1000);
    });

    // ポップアップ要素
    let popup = new mapboxgl.Popup({
        closeOnClick: false // クリックで閉じない
    });

    let selectedRouteOld = null;

    map.on('mouseover', 'bus-locations', async (e) => {
        // 💡 該当フィーチャの取得
        // e.featuresには、マウスポインタの下にあるフィーチャ（円）が配列として格納されています。
        if (e.features.length > 0) {
            const feature = e.features[0];

            if (selectedRouteOld !== feature.properties.route) {
                selectedRouteOld = feature.properties.route;
            } else {
                return;
            }

            // 系統情報の取得
            const url = `${API_BASE_URL}get_route_information?id=${feature.properties.route}`;
            const routeInformation = await fetchApiData(url);
            if (!routeInformation) return null;

            const route = routeInformation[0]['dc:title'].replace(/^0+/, '');   // 先頭の0を除去

            // 行先の取得
            const destination = routeInformation[0]['odpt:busstopPoleOrder'].at(-1)['odpt:note'];
            
            // ポップアップに表示する情報を作成
            // GeoJSONのpropertiesに追加した情報を参照できます

            const congestionStrings = ['空いています', '空いています', '混んでいます', '非常に混んでいます', '満員です', '満員です', '満員です'];

            const description = `
                <strong>${route}</strong>・${destination} 行
                <div class="congestion"><img src="https://buscom.jp/assets/congestion_${String(feature.properties.congestion)}.png" alt="混雑度">${congestionStrings[feature.properties.congestion]}</div>
            `;

            // 💡 ポップアップの表示・更新
            popup
                .setLngLat(feature.geometry.coordinates) // フィーチャの座標に設定
                .setHTML(description) // HTMLコンテンツを設定
                .addTo(map); // 地図に追加（表示）
                
            // 💡 カーソルをポインタに変更
            map.getCanvas().style.cursor = 'pointer';

            // 選択されたバスの路線を強調（新規レイヤー）
            for (let i = 0; i < busRoutesGeoJson['features'].length; i++) {
                const route = busRoutesGeoJson['features'][i];

                if (route.properties.route === feature.properties.route) {
                    busRoutesGeoJson['features'][i]['properties']['selected'] = 1;
                }
            }

            map.getSource('route-lines').setData(busRoutesGeoJson);
        }
    });

    //
    map.on('click', 'bus-locations', async (e) => {
        const feature = e.features[0];
        routeDetail(feature.properties.route);
    });

    // ---
    // 3. マウスが円から離れた時の処理 (ポップアップを隠す)
    // ---

    const unselect = () => {        
        // ポップアップを非表示
        popup.remove();
        
        // カーソルをデフォルトに戻す
        map.getCanvas().style.cursor = '';

        // 強調した路線を戻す
        for (let i = 0; i < busRoutesGeoJson['features'].length; i++) {
            if (busRoutesGeoJson['features'][i]['properties']['selected'] === 1) {
                busRoutesGeoJson['features'][i]['properties']['selected'] = 0;
            }
        }

        map.getSource('route-lines').setData(busRoutesGeoJson);

        selectedRouteOld = null;
    }

    map.on('mouseleave', 'bus-locations', unselect);
    map.on('click', unselect);

    //
    // 現在地を表示
    //
    let isError = false;
    let latitude = null;
    let longitude = null;

    let currentLocationPopup = new mapboxgl.Popup();

    const getCurrentLocation = (location) => {
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;

        /*// マーカーを作成し、地図に追加
        new mapboxgl.Marker({color : '#4dcaff'})
            .setLngLat([longitude, latitude])
            .addTo(map);*/
    }

    const updateCurrentLocation = (location) => {
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;

        currentLocationPopup.setLngLat([longitude, latitude]);
    }

    const getCurrentLocationError = () => {
        isError = true;
    }

    const goToCurrentLocation = async () => {
        if (isError) {
            alert('位置情報の取得に失敗しました。');
        }

        if (longitude !== null && latitude !== null) {
            map.flyTo({
                center: [longitude, latitude],
            });

            currentLocationPopup
                .setLngLat([longitude, latitude]) // フィーチャの座標に設定
                .setHTML('現在地') // HTMLコンテンツを設定
                .addTo(map); // 地図に追加（表示）

            setTimeout(() => {
                currentLocationPopup.remove();
            }, 3000);
        }
    }

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(getCurrentLocation, getCurrentLocationError);
        navigator.geolocation.watchPosition(updateCurrentLocation);

        document.getElementById('go-to-current-location').addEventListener('click', goToCurrentLocation);
    } else {
        alert('お使いのブラウザは、位置情報の取得に対応していません。');
        document.getElementById('go-to-current-location').style.color = '#888888';
    }

    // 凡例・注意事項
    const instructions = document.getElementById('instructions');

    document.getElementById('show-instructions').addEventListener('click', () => {
        instructions.style.display = 'block';
    })

    document.getElementById('close-instructions').addEventListener('click', () => {
        instructions.style.display = 'none';
    })
};

// DOMの読み込みが完了したらメイン処理を実行
window.addEventListener('DOMContentLoaded', main);