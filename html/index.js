let operator = 'yokohamaMunicipal';
let operatorStr = '横浜市営バス';

// operatorの識別子と表示名の対応表
const operatorMap = {
    'yokohamaMunicipal': '横浜市営バス',
    'rinkoBus': '臨港バス',
    'toBus': '都営バス'
};

document.getElementById('clear-favorite').style.display = 'none';

const operatorSelectors = document.getElementsByClassName('select-operator');

for (let i = 0; i < operatorSelectors.length; i++) {
    operatorSelectors[i].addEventListener('click', () => {
        selectOperator(operatorSelectors[i]);
    });
}

const selectOperator = (elem) => {   
    operator = elem.id;
    operatorStr = elem.textContent;
    document.getElementById('result').innerHTML = '';
    document.getElementById('clear-favorite').style.display = 'none';

    for (let i = 0; i < operatorSelectors.length; i++) {
        if (operatorSelectors[i] === elem) {
            operatorSelectors[i].setAttribute('class', 'select-operator transition duration-200 ease-in-out inline-block p-4 text-blue-600 bg-blue-50 rounded-t-lg active');
        } else {
            operatorSelectors[i].setAttribute('class', 'select-operator transition duration-200 ease-in-out inline-block p-4 rounded-t-lg hover:text-gray-600 hover:bg-gray-50');
        }
    }

    // operatorが"history"(履歴)でない場合のみ、operatorを変更
    // historyが選択された場合は、operatorを変更せず、履歴表示の処理を行う
    if (elem.id === 'history') {
        const historyData = localStorage.getItem('history');
        document.getElementById('search-input').disabled = true;

        if (historyData) {
            const history = JSON.parse(historyData);
            if (history.length > 0) {
                updateStopResult(history);
            }
        } else {
            document.getElementById('result').innerHTML = '<div class="container mx-auto w-full py-4"><div class="text-center text-gray-700">履歴がありません</div></div>';
        }

    } else if (elem.id === 'favorite') {
        const favoriteData = localStorage.getItem('favorites');
        document.getElementById('search-input').disabled = true;

        if (favoriteData) {
            const favorites = JSON.parse(favoriteData);
            if (favorites.length > 0) {
                updateStopResult(favorites);
            }
            
            document.getElementById('clear-favorite').style.display = 'inline-block';
        } else {
            document.getElementById('result').innerHTML = '<div class="container mx-auto w-full py-4"><div class="text-center text-gray-700">お気に入りがありません</div></div>';
        }
    } else {
        document.getElementById('search-input').disabled = false;
    }
}

// 
document.getElementById('search-list').style.display = 'none';

document.getElementById('search-input').addEventListener('keyup', async () => {
    if (document.getElementById('search-input').value === '') {
        return;
    }

    document.getElementById('search-list').style.display = 'grid';

    const url = `/api/${operator}/search?query=${encodeURIComponent(document.getElementById('search-input').value)}`;
        
    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        updateList(JSON.parse(data));
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('search-input').addEventListener('focusout', () => {
    setTimeout(async () => {
        document.getElementById('search-list').style.display = 'none';

        if (document.getElementById('search-input').value === '') {
            return;
        }

        const url = `/api/${operator}/search?query=${encodeURIComponent(document.getElementById('search-input').value)}`;
        
        try {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            const data = await res.json();
            updateStopResult(JSON.parse(data));
        } catch (err) {
            console.error(err);
        }
    }, 200);
});

// 候補リストの各要素をクリックしたとき
const searchListClickEvent = (event) => {
    document.getElementById('search-input').value = event.target.textContent
    document.getElementById('search-list').style.display = 'none';
}

// 入力から候補リストを更新
const updateList = (json) => {
    const listArea = document.getElementById('search-list');

    let names = new Array();
    for (let i = 0; i < json.length; i++) {
        if (!names.includes(json[i].stop_name)) {
            names.push(json[i].stop_name);
        }

        if (i > 7) {
            break;
        }
    }

    let resultDom = '';

    for (let i = 0; i < names.length; i++) {
        resultDom += `<a href="javascript:void(0);"><div class="p-2 hover:bg-gray-50 transition-150"><span>${names[i]}</span></div></a>`;
    }

    // 既存のイベントリスナは削除
    for (let i = 0; i < document.getElementById('search-list').children.length; i++) {
        document.getElementById('search-list').children[i].removeEventListener('click', searchListClickEvent);
    }

    listArea.innerHTML = resultDom;

    for (let i = 0; i < document.getElementById('search-list').children.length; i++) {
        document.getElementById('search-list').children[i].addEventListener('click', searchListClickEvent);
    }
}

// 検索結果クリック時のイベント（履歴に追加）
const stopResultClickEvent = (event) => {
    // 履歴保存が無効なら、何もしない
    if (!document.getElementById('save-history').checked) {
        return;
    }

    const poleInfo = event.currentTarget.poleInfo;

    const operator = poleInfo.operator;
    const stopId = poleInfo.stop_id;
    const stopName = poleInfo.stop_name;
    const routes = poleInfo.routes;
    const date = new Date().getTime();    // 新しい順にソートするため

    // 現在保存されている履歴データを取得し、追加して再度保存
    let history = localStorage.getItem('history');

    if (history) {
        history = JSON.parse(history);

        // 重複は保存しない、ただしdateは更新
        let found = false;
        for (let i = 0; i < history.length; i++) {
            if (history[i].operator === operator && history[i].stop_id === stopId) {
                found = true;
                history[i].date = date;
                break;
            }

            // 最大10件まで
            if (i >= 9) {
                history.pop();
                break;
            }
        }
        
        if (!found) {
            // 履歴になかった場合、追加
            history.push({operator: operator, stop_id: stopId, stop_name: stopName, routes: routes, date: date});
        }

        // 日付でソート（新しい順）
        history.sort((a, b) => b.date - a.date);
    } else {
        // 履歴がない場合は新規作成
        history = [{operator: operator, stop_id: stopId, stop_name: stopName, routes: routes, date: date}];
    }

    localStorage.setItem('history', JSON.stringify(history));
}

// 停留所検索結果の表示
const updateStopResult = (json) => {
    // JSONデータにoperatorが含まれていない場合、グローバル変数から設定
    for (let i = 0; i < json.length; i++) {
        if (!json[i].hasOwnProperty('operator')) {
            json[i].operator = operator;
        }
    }

    const resultArea = document.getElementById('result');
    resultArea.innerHTML = '';

    const resultContainer = document.createElement('div');
    resultContainer.setAttribute('class', 'container mx-auto w-full py-4');
    resultContainer.setAttribute('id', 'result-list');

    const resultParent = document.createElement('div');
    resultParent.setAttribute('class', 'flex flex-wrap md:flex-nowrap md:overflow-x-auto box-border m-2');

    for (let i = 0; i < json.length; i++) {
        const resultElement = document.createElement('a');
        resultElement.setAttribute('href', `${json[i].operator}/?id=${json[i].stop_id}&name=${json[i].stop_name}`);
        resultElement.setAttribute('target', '_blank');
        resultElement.setAttribute('class', 'transition duration-200 ease-in-out block flex-none p-4 bg-white border border-gray-200 rounded-lg drop-shadow-lg hover:bg-gray-100 w-full md:w-1/5 my-2 md:mx-2');
        if (operator !== 'history' && operator !== 'favorite') {
            resultElement.addEventListener('click', stopResultClickEvent);
        }

        // 履歴機能用にデータをセット
        resultElement.poleInfo = json[i];

        let resuleRouteDom = '';
        for (let j = 0; j < json[i].routes.length; j++) {
            resuleRouteDom += `<li class="my-0.5">
                <span class="bg-blue-500 text-blue-50 px-1.5 py-0.5 rounded-md">${json[i].routes[j][0]}</span>
                ${json[i].routes[j][1]}
                </li>`;
        }

        resultElement.innerHTML = `<p class="text-sm text-gray-700">${operatorMap[json[i].operator]}</p>
            <h5 class="mb-2 text-2xl font-bold tracking-tight text-gray-900">${json[i].stop_name}</h5>
            <ul class="text-gray-700">${resuleRouteDom}</ul>`;

        resultParent.appendChild(resultElement);
    }
    
    resultContainer.appendChild(resultParent);
    resultArea.appendChild(resultContainer);

    // 既存のイベントリスナは削除
    for (let i = 0; i < document.getElementById('result').children.length; i++) {
        document.getElementById('result').children[i].removeEventListener('click', stopResultClickEvent);
    }
}

document.getElementById('clear-history').addEventListener('click', () => {
    if (confirm('履歴を削除しますか？')) {
        localStorage.removeItem('history');

        if (operator === 'history') {
            document.getElementById('result').innerHTML = '<div class="container mx-auto w-full py-4"><div class="text-center text-gray-700">履歴がありません。</div></div>';
        }
}
});

document.getElementById('clear-favorite').addEventListener('click', () => {
    if (confirm('お気に入りを削除しますか？')) {
        localStorage.removeItem('favorites');
        
        if (operator === 'favorite') {
            document.getElementById('result').innerHTML = '<div class="container mx-auto w-full py-4"><div class="text-center text-gray-700">お気に入りがありません。</div></div>';
            document.getElementById('clear-favorite').style.display = 'none';
        }
    }
});