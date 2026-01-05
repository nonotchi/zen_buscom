let done = false;

get = async (stopId) => {
    const resultDom = document.getElementById('timetable');

    let trips = {};

    const url = `/api/toBus/get_departures?id=${stopId}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(response.status);
        }

        const json = JSON.parse(await response.json());

        resultDom.innerHTML = '';
        let lastTime = '';

        if (json.length === 0) {
            resultDom.innerHTML = '発着便がありません。指定日には運行がないか、降車専用の停留所です。';
        }

        for (let i = 0; i < json.length; i++) {
            const trip = json[i];

            // 時刻インデックス
            const time = parseInt(trip.departure_time.split(':')[0]);
            if (time != lastTime) {
                lastTime = time;
                resultDom.innerHTML += `<div id="${time}" class="w-fit text-2xl font-bold m-auto">${time}時台</div>`;
            }

            // trip
            const elem = document.createElement('div');
            elem.setAttribute('class', 'trip');

            const departureDom = `<div class="transition duration-200 ease-in-out flex-none p-4 bg-white border border-gray-200 rounded-lg drop-shadow-lg w-full md:w-1/2 my-2 md:mx-auto relative">
                <div class="time text-2xl font-bold">${trip.departure_time}</div>
                <div><span class="bg-blue-500 text-blue-50 px-1.5 py-0.5 rounded-md mx-1">${trip.route_name}</span>${trip.destination}</div>
                <hr class="w-full h-0.5 mx-auto my-2 bg-gray-100 border-0 rounded-md">
                <div id="${trip.trip_id}" class="remarks text-gray-700"></div>
            </div>`;

            resultDom.innerHTML += departureDom;

            trips[trip.trip_id] = trip.stop_sequence;
        }
    } catch (error) {
        console.error(error.message);
    }

    return trips;
}

window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);

    const stopId = urlParams.get('id');
    const stopName = urlParams.get('name');

    document.title = `${stopName}のバス時刻表 - バスコム`;
    document.getElementById('name').textContent = stopName;

    // 乗車日
    const date = new Date();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    document.getElementById('date').textContent = `乗車日:${month}月${day}日`;

    // お気に入り登録されていたら、アイコンを変更
    if (localStorage.getItem('favorites')) {
        const favorites = JSON.parse(localStorage.getItem('favorites'));
        for (let i = 0; i < favorites.length; i++) {
            if (favorites[i].operator === 'toBus' && favorites[i].stop_id === stopId) {
                document.getElementById('add-to-favorite').classList.add('hidden');
                document.getElementById('remove-from-favorite').classList.remove('hidden');
                break;
            }
        }
    }

    document.getElementById('loading').style.transition = '1s';

    const trips = await get(stopId);

    document.getElementById('loading').style.opacity = '0';
    document.getElementById('timetable').style.display = 'block';
    
    done = true;

    setTimeout(() => {
        document.getElementById('loading').remove();
    }, 1000);

    update(trips, stopId);

    setInterval(() => {
        update(trips, stopId);
    }, 15 * 1000)
});

// RT_data
update = async (trips, stopId) => {
    try {
        let tripsArray = [];
        for (trip in trips) {
            tripsArray.push(trip);
        }

        const response = await fetch(`/api/toBus/get_rt_data`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                trips: tripsArray,
                id: stopId
            })
        });
        if (!response.ok) {
            throw new Error(response.status);
        }

        const json = JSON.parse(await response.json());

        for (trip in json) {
            const vehicle = json[trip];
            const remarks = document.getElementById(trip);
            
            let str = '';

            if ('position' in vehicle) {
                const sequence = trips[trip] - vehicle.position;
                const positionName = vehicle.position_name;

                if (sequence <= 0) {
                    // 通過済み
                    remarks.innerText = '';
                    continue;
                } else {
                    str += `${sequence}個前の停留所(${positionName})を発車しました。`;
                }

                if ('departure' in vehicle) {
                    str += `\n${vehicle.departure}に発車予定です。`
                }
            } else {
                continue;
            }

            remarks.innerText = str;
        }

    } catch (error) {
        console.error(error.message);
    }
}

// 現在時刻付近へのジャンプ機能
document.getElementById('go-to-current-time').addEventListener('click', () => {
    if (!done) {
        return;
    }

    const targets = document.getElementsByClassName('time');
    let departures = new Array();
    for (let i = 0; i < targets.length; i++) {
        const timeStr = targets[i].textContent;
        departures.push({time: timeStr, elem: targets[i]});
    }

    // 現在時刻に最も近い発車時刻を探す
    let closestElem = null;
    let closestDiff = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < departures.length; i++) {
        const depTime = departures[i].time;
        const depDate = new Date();
        const [depHours, depMinutes] = depTime.split(':').map(Number);
        depDate.setHours(depHours, depMinutes, 0, 0);
        const nowDate = new Date();
        const diff = Math.abs(depDate - nowDate);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestElem = departures[i].elem;
        }
    }

    // スクロール
    if (closestElem) {
        closestElem.scrollIntoView({block: 'center'});
    }
});

// お気に入り登録
document.getElementById('add-to-favorite').addEventListener('click', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stopId = urlParams.get('id');
    const stopName = urlParams.get('name');
    const date = new Date().getTime();

    // この停留所を発着する系統番号と行先を検索APIから取得
    const url = `/api/toBus/search?query=${encodeURIComponent(stopName)}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = JSON.parse(await res.json());

        let result = null;
        if (data.length > 0) {
            for (let i = 0; i < data.length; i++) {
                if (data[i].stop_id === stopId) {
                    result = data[i];
                    break;
                }
            }

            // お気に入り追加処理
            let favorites = localStorage.getItem('favorites');

            if (favorites) {
                favorites = JSON.parse(favorites);
                favorites.push({operator: 'toBus', stop_id: result.stop_id, stop_name: result.stop_name, routes: result.routes, date: date});
                favorites.sort((a, b) => b.date - a.date);
            } else {
                favorites = [{operator: 'toBus', stop_id: result.stop_id, stop_name: result.stop_name, routes: result.routes, date: date}];
            }

            localStorage.setItem('favorites', JSON.stringify(favorites));

            // アイコン変更
            document.getElementById('add-to-favorite').classList.add('hidden');
            document.getElementById('remove-from-favorite').classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
        return;
    }
});

// お気に入り削除
document.getElementById('remove-from-favorite').addEventListener('click', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stopId = urlParams.get('id');
    let favorites = localStorage.getItem('favorites');

    if (favorites) {
        favorites = JSON.parse(favorites);

        favorites = favorites.filter(fav => !(fav.operator === 'toBus' && fav.stop_id === stopId));
        localStorage.setItem('favorites', JSON.stringify(favorites));
    }

    // アイコン変更
    document.getElementById('add-to-favorite').classList.remove('hidden');
    document.getElementById('remove-from-favorite').classList.add('hidden');
});