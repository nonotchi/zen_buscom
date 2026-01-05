import yokohamaMunicipal.prepare_gtfs_data
import yokohamaMunicipal.record_congestion
import rinkoBus.prepare_gtfs_data
import rinkoBus.record_congestion
import toBus.prepare_gtfs_data
import toBus.record_congestion
import map.yokohamaMunicipal.request
import time
import datetime
import concurrent.futures

last_daily_run_date = None

# 実行するタスクをわかりやすくまとめておく
DAILY_INIT_TASKS = (
    yokohamaMunicipal.prepare_gtfs_data.init,
    rinkoBus.prepare_gtfs_data.init,
    toBus.prepare_gtfs_data.init,
    map.yokohamaMunicipal.request.init
)
REALTIME_TASKS = (
    yokohamaMunicipal.record_congestion.main,
    rinkoBus.record_congestion.main,
    toBus.record_congestion.main,
    map.yokohamaMunicipal.request.main
)
# タイムアウト時間（秒）
REALTIME_TASK_TIMEOUT = 25 
DAILY_TASK_TIMEOUT = 300

def should_run_daily():
    global last_daily_run_date
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=9) # JST

    # 毎日4時半に1回だけ実行
    if now.hour == 4 and now.minute == 30:
        if last_daily_run_date != now.day:
            last_daily_run_date = now.day
            return True
    return False

def run_tasks_async(tasks, timeout):
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future_to_task = {executor.submit(task): task for task in tasks}

        for future in concurrent.futures.as_completed(future_to_task):
            task_name = future_to_task[future].__name__
            module_name = future_to_task[future].__module__
            
            try:
                future.result(timeout=timeout) 
                print(f"✅ Task '{module_name}.{task_name}' completed successfully.")
            except concurrent.futures.TimeoutError:
                print(f"⏰ Error: Task '{module_name}.{task_name}' timed out after {timeout} seconds.")
            except Exception as e:
                print(f"❌ Error in task '{module_name}.{task_name}': {e}")


if __name__ == "__main__": 
    while True:
        # 1日1回早朝に実行
        if should_run_daily():
            print("🚀 Running daily init tasks...")
            run_tasks_async(DAILY_INIT_TASKS, timeout=DAILY_TASK_TIMEOUT)

        now = datetime.datetime.utcnow() + datetime.timedelta(hours=9) # JST
        
        if now.hour >= 5 or now.hour == 1:
            print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 🚀 Running real-time tasks...")
            run_tasks_async(REALTIME_TASKS, timeout=REALTIME_TASK_TIMEOUT)

        time.sleep(15)  # 15秒ごと