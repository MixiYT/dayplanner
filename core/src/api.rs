//! Единая точка входа для интерфейса: `dispatch("команда", {аргументы})`.
//! Интерфейс и Tauri-обёртка не знают о внутренностях ядра — только об этих командах.

use std::sync::{Mutex, MutexGuard};

use chrono::{NaiveDate, NaiveDateTime};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::model::{Category, Reminder, ScheduleEntry};
use crate::online;
use crate::store::Store;
use crate::timefmt::dt;

/// Команды, после которых нужно пересчитать будильники и виджеты.
pub const MUTATING: &[&str] = &[
    "categories.save",
    "categories.delete",
    "reminders.save",
    "reminders.delete",
    "reminders.archive",
    "schedule.save",
    "schedule.delete",
    "complete",
    "skip",
    "undo",
    "settings.set",
];

fn lock(m: &Mutex<Store>) -> Result<MutexGuard<'_, Store>> {
    m.lock().map_err(|_| Error::Invalid("внутренняя ошибка: блокировка хранилища".into()))
}

fn get<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    let v = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(v).map_err(|e| Error::Invalid(format!("параметр «{key}»: {e}")))
}

fn get_dt(args: &Value, key: &str) -> Result<NaiveDateTime> {
    let s: String = get(args, key)?;
    dt::parse(&s).map_err(Error::Invalid)
}

fn to_v<T: Serialize>(t: T) -> Result<Value> {
    Ok(serde_json::to_value(t)?)
}

/// Выполняет команду интерфейса. `now` — локальное время устройства.
pub fn dispatch(store: &Mutex<Store>, now: NaiveDateTime, cmd: &str, args: Value) -> Result<Value> {
    if let Some(rest) = cmd.strip_prefix("online.") {
        return online_cmd(store, now, rest, &args);
    }
    let s = lock(store)?;
    match cmd {
        "now" => to_v(dt::format(&now)),

        "categories.list" => to_v(s.list_categories()?),
        "categories.save" => {
            let c: Category = get(&args, "category")?;
            to_v(s.save_category(&c)?)
        }
        "categories.delete" => {
            s.delete_category(get(&args, "id")?)?;
            Ok(Value::Null)
        }

        "reminders.list" => {
            let archived: Option<bool> = get(&args, "archived")?;
            to_v(s.list_reminders(archived.unwrap_or(false))?)
        }
        "reminders.save" => {
            let r: Reminder = get(&args, "reminder")?;
            to_v(s.save_reminder(&r)?)
        }
        "reminders.delete" => {
            s.delete_reminder(get(&args, "id")?)?;
            Ok(Value::Null)
        }
        "reminders.archive" => {
            let archived: bool = get(&args, "archived")?;
            s.set_archived(get(&args, "id")?, archived)?;
            Ok(Value::Null)
        }

        "schedule.list" => to_v(s.list_schedule()?),
        "schedule.save" => {
            let e: ScheduleEntry = get(&args, "entry")?;
            to_v(s.save_schedule(&e)?)
        }
        "schedule.delete" => {
            s.delete_schedule(get(&args, "id")?)?;
            Ok(Value::Null)
        }

        "day" => {
            let date: NaiveDate = get(&args, "date")?;
            to_v(s.day_view(date, now)?)
        }
        "week" => {
            let date: NaiveDate = get(&args, "date")?;
            to_v(s.week_view(date, now)?)
        }
        "pending" => to_v(s.pending(now)?),

        "complete" => {
            let id: i64 = get(&args, "reminder_id")?;
            to_v(s.complete(id, get_dt(&args, "at")?, now)?)
        }
        "skip" => {
            let id: i64 = get(&args, "reminder_id")?;
            s.skip(id, get_dt(&args, "at")?, now)?;
            Ok(Value::Null)
        }
        "undo" => {
            let id: i64 = get(&args, "reminder_id")?;
            s.undo(id, get_dt(&args, "at")?)?;
            Ok(Value::Null)
        }

        // Для системной интеграции: что планировать в будильнике и что рисовать в виджетах.
        "alarms" => {
            let days: Option<i64> = get(&args, "days")?;
            let limit: Option<usize> = get(&args, "limit")?;
            to_v(s.upcoming_alarms(now, days.unwrap_or(30).clamp(0, 60), limit.unwrap_or(200).min(400))?)
        }
        "widget" => to_v(s.widget_snapshot(now)?),

        "stats" => to_v(s.stats(now)?),
        "achievements" => to_v(s.achievements(now)?),

        "settings.get" => to_v(s.settings_with_defaults()?),
        "settings.set" => {
            let key: String = get(&args, "key")?;
            let value: String = get(&args, "value")?;
            if key.is_empty() || key.len() > 64 || key == "online.token" {
                return Err(Error::Invalid("недопустимый ключ настройки".into()));
            }
            s.set_setting(&key, &value)?;
            Ok(Value::Null)
        }

        other => Err(Error::Invalid(format!("неизвестная команда: {other}"))),
    }
}

/// Сетевые команды: хранилище блокируется только на время чтения/записи, не на время запроса.
fn online_cmd(store: &Mutex<Store>, now: NaiveDateTime, cmd: &str, args: &Value) -> Result<Value> {
    match cmd {
        "register" => {
            let nickname: String = get(args, "nickname")?;
            online::register(store, &nickname)
        }
        "push" => online::push(store, now),
        "leaderboard" => {
            let period: Option<String> = get(args, "period")?;
            let room_only: Option<bool> = get(args, "room_only")?;
            online::leaderboard(store, period.as_deref().unwrap_or("week"), room_only.unwrap_or(false))
        }
        "logout" => {
            let s = lock(store)?;
            s.delete_setting("online.token")?;
            Ok(json!({ "ok": true }))
        }
        other => Err(Error::Invalid(format!("неизвестная команда: online.{other}"))),
    }
}
