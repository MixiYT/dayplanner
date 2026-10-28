use std::sync::Mutex;

use chrono::{NaiveDate, NaiveDateTime};
use planner_core::achievements::level_for;
use planner_core::api::dispatch;
use planner_core::model::*;
use planner_core::recurrence::occurrences;
use planner_core::Store;
use serde_json::json;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn t(y: i32, m: u32, day: u32, h: u32, mi: u32) -> NaiveDateTime {
    d(y, m, day).and_hms_opt(h, mi, 0).unwrap()
}

fn rem(title: &str, start: NaiveDateTime, repeat: Repeat) -> Reminder {
    Reminder { title: title.into(), start, repeat, ..Reminder::default() }
}

fn store() -> Store {
    Store::open_in_memory().unwrap()
}

// ---------- повторения ----------

#[test]
fn weekdays_repeat_picks_only_chosen_days() {
    // 2026-10-26 — понедельник
    let r = rem("Спорт", t(2026, 10, 26, 9, 0), Repeat::Weekdays { days: vec![1, 3] });
    let got = occurrences(&r, d(2026, 10, 26), d(2026, 11, 1));
    assert_eq!(got, vec![t(2026, 10, 26, 9, 0), t(2026, 10, 28, 9, 0)]);
}

#[test]
fn monthly_repeat_clamps_to_last_day() {
    let r = rem("Платёж", t(2026, 1, 31, 10, 0), Repeat::Monthly);
    assert_eq!(occurrences(&r, d(2026, 2, 1), d(2026, 2, 28)), vec![t(2026, 2, 28, 10, 0)]);
    assert_eq!(occurrences(&r, d(2026, 3, 1), d(2026, 3, 31)), vec![t(2026, 3, 31, 10, 0)]);
}

#[test]
fn repeat_until_is_respected() {
    let mut r = rem("Курс", t(2026, 10, 26, 9, 0), Repeat::Daily);
    r.repeat_until = Some(d(2026, 10, 28));
    assert_eq!(occurrences(&r, d(2026, 10, 26), d(2026, 10, 31)).len(), 3);
}

#[test]
fn one_time_reminder_fires_once() {
    let r = rem("Звонок", t(2026, 10, 26, 9, 0), Repeat::None);
    assert_eq!(occurrences(&r, d(2026, 10, 1), d(2026, 12, 31)), vec![t(2026, 10, 26, 9, 0)]);
}

// ---------- проверка данных ----------

#[test]
fn validation_rejects_bad_input() {
    let s = store();
    assert!(s.save_reminder(&rem("  ", t(2026, 10, 26, 9, 0), Repeat::None)).is_err());
    assert!(s
        .save_reminder(&rem("x", t(2026, 10, 26, 9, 0), Repeat::Weekdays { days: vec![] }))
        .is_err());
    assert!(s
        .save_reminder(&rem("x", t(2026, 10, 26, 9, 0), Repeat::Weekdays { days: vec![8] }))
        .is_err());

    let bad = ScheduleEntry {
        title: "Лекция".into(),
        weekday: Some(1),
        start: chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        end: chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
        ..ScheduleEntry::default()
    };
    assert!(s.save_schedule(&bad).is_err());
    let both = ScheduleEntry { title: "x".into(), weekday: Some(1), date: Some(d(2026, 10, 26)), ..ScheduleEntry::default() };
    assert!(s.save_schedule(&both).is_err());
}

// ---------- статусы и выполнение ----------

#[test]
fn status_changes_over_time() {
    let s = store();
    let mut r = rem("Лекарство", t(2026, 10, 26, 10, 0), Repeat::None);
    r.grace_minutes = 30;
    let r = s.save_reminder(&r).unwrap();
    let status = |now: NaiveDateTime| s.day_view(d(2026, 10, 26), now).unwrap().items[0].status;

    assert_eq!(status(t(2026, 10, 26, 9, 0)), Status::Upcoming);
    assert_eq!(status(t(2026, 10, 26, 10, 10)), Status::Due);
    assert_eq!(status(t(2026, 10, 26, 10, 31)), Status::Missed);

    s.complete(r.id, t(2026, 10, 26, 10, 0), t(2026, 10, 26, 10, 10)).unwrap();
    assert_eq!(status(t(2026, 10, 26, 12, 0)), Status::DoneOnTime);
}

#[test]
fn complete_on_time_gives_points_and_first_achievement() {
    let s = store();
    let mut r = rem("Зарядка", t(2026, 10, 26, 10, 0), Repeat::None);
    r.grace_minutes = 30;
    let r = s.save_reminder(&r).unwrap();

    let out = s.complete(r.id, t(2026, 10, 26, 10, 0), t(2026, 10, 26, 10, 20)).unwrap();
    assert_eq!(out.status, Status::DoneOnTime);
    assert_eq!(out.points, 10);
    assert!(out.unlocked.iter().any(|a| a.id == "first_step"));
    // 10 за выполнение + 5 награда за «Первый шаг»
    assert_eq!(out.total_points, 15);
}

#[test]
fn complete_after_grace_is_late() {
    let s = store();
    let mut r = rem("Отчёт", t(2026, 10, 26, 10, 0), Repeat::None);
    r.grace_minutes = 30;
    let r = s.save_reminder(&r).unwrap();
    let out = s.complete(r.id, t(2026, 10, 26, 10, 0), t(2026, 10, 26, 11, 0)).unwrap();
    assert_eq!(out.status, Status::DoneLate);
    assert_eq!(out.points, 4);
}

#[test]
fn cannot_complete_twice_or_wrong_time_or_far_future() {
    let s = store();
    let r = s.save_reminder(&rem("Дело", t(2026, 10, 26, 10, 0), Repeat::None)).unwrap();
    let now = t(2026, 10, 26, 10, 5);
    s.complete(r.id, t(2026, 10, 26, 10, 0), now).unwrap();
    assert!(s.complete(r.id, t(2026, 10, 26, 10, 0), now).is_err(), "повторная отметка");
    assert!(s.complete(r.id, t(2026, 10, 26, 10, 5), now).is_err(), "нет такого срабатывания");

    let daily = s.save_reminder(&rem("Ежедневное", t(2026, 10, 26, 10, 0), Repeat::Daily)).unwrap();
    // до срабатывания 26 часов — слишком рано
    assert!(s.complete(daily.id, t(2026, 10, 27, 10, 0), t(2026, 10, 26, 8, 0)).is_err());
}

#[test]
fn skipped_is_not_missed_and_undo_removes_points() {
    let s = store();
    let r = s.save_reminder(&rem("Дело", t(2026, 10, 26, 10, 0), Repeat::None)).unwrap();
    let later = t(2026, 10, 27, 12, 0);
    assert_eq!(s.stats(later).unwrap().missed, 1);
    s.skip(r.id, t(2026, 10, 26, 10, 0), later).unwrap();
    let st = s.stats(later).unwrap();
    assert_eq!(st.missed, 0);
    assert_eq!(st.skipped, 1);

    s.complete(r.id, t(2026, 10, 26, 10, 0), later).unwrap();
    assert!(s.stats(later).unwrap().points > 0);
    s.undo(r.id, t(2026, 10, 26, 10, 0)).unwrap();
    assert_eq!(s.stats(later).unwrap().total_done, 0);
}

#[test]
fn deleting_reminder_keeps_history() {
    let s = store();
    let r = s.save_reminder(&rem("Дело", t(2026, 10, 26, 10, 0), Repeat::None)).unwrap();
    s.complete(r.id, t(2026, 10, 26, 10, 0), t(2026, 10, 26, 10, 1)).unwrap();
    s.delete_reminder(r.id).unwrap();
    assert_eq!(s.stats(t(2026, 10, 26, 12, 0)).unwrap().total_done, 1);
}

// ---------- серии и достижения ----------

fn daily_with_three_days_done(s: &Store) -> i64 {
    let r = s.save_reminder(&rem("Привычка", t(2026, 10, 20, 9, 0), Repeat::Daily)).unwrap();
    for day in 20..=22 {
        s.complete(r.id, t(2026, 10, day, 9, 0), t(2026, 10, day, 9, 5)).unwrap();
    }
    r.id
}

#[test]
fn streak_counts_clean_days_and_breaks_on_miss() {
    let s = store();
    daily_with_three_days_done(&s);

    let st = s.stats(t(2026, 10, 22, 12, 0)).unwrap();
    assert_eq!(st.current_streak, 3);
    assert_eq!(st.best_streak, 3);
    assert_eq!(st.missed, 0);

    // 23-го и 24-го отметок нет — серия прервана, рекорд остаётся
    let st = s.stats(t(2026, 10, 24, 12, 0)).unwrap();
    assert_eq!(st.current_streak, 0);
    assert_eq!(st.best_streak, 3);
    assert_eq!(st.missed, 2);
}

#[test]
fn today_pending_item_does_not_break_streak() {
    let s = store();
    daily_with_three_days_done(&s);
    // 23-го в 08:00 сегодняшнее дело ещё впереди
    assert_eq!(s.stats(t(2026, 10, 23, 8, 0)).unwrap().current_streak, 3);
}

#[test]
fn pending_lists_recent_unmarked_items() {
    let s = store();
    daily_with_three_days_done(&s);
    let p = s.pending(t(2026, 10, 24, 12, 0)).unwrap();
    assert_eq!(p.len(), 2);
    assert!(p.iter().all(|i| i.status == Status::Missed));
}

#[test]
fn streak_achievement_is_unlocked_with_reward() {
    let s = store();
    daily_with_three_days_done(&s);
    let list = s.achievements(t(2026, 10, 22, 12, 0)).unwrap();
    let streak3 = list.iter().find(|a| a.id == "streak_3").unwrap();
    assert!(streak3.unlocked);
    assert_eq!(streak3.progress, 3);
    let streak7 = list.iter().find(|a| a.id == "streak_7").unwrap();
    assert!(!streak7.unlocked);
    assert_eq!(streak7.progress, 3);
}

#[test]
fn organizer_achievement_needs_three_categories() {
    let s = store();
    let now = t(2026, 10, 26, 8, 0);
    for cat in [1, 2] {
        let mut r = rem("x", t(2026, 10, 26, 9, 0), Repeat::None);
        r.category_id = Some(cat);
        s.save_reminder(&r).unwrap();
    }
    assert!(s.evaluate_achievements(now).unwrap().iter().all(|a| a.id != "organizer"));
    let mut r = rem("x", t(2026, 10, 26, 9, 0), Repeat::None);
    r.category_id = Some(3);
    s.save_reminder(&r).unwrap();
    assert!(s.evaluate_achievements(now).unwrap().iter().any(|a| a.id == "organizer"));
    // повторно не выдаётся
    assert!(s.evaluate_achievements(now).unwrap().is_empty());
}

#[test]
fn levels_grow_with_points() {
    assert_eq!(level_for(0), (1, 0.0));
    assert_eq!(level_for(49).0, 1);
    assert_eq!(level_for(50).0, 2);
    assert_eq!(level_for(200).0, 3);
}

// ---------- расписание ----------

#[test]
fn week_view_contains_weekly_and_one_off_entries() {
    let s = store();
    let weekly = ScheduleEntry {
        title: "Матан".into(),
        weekday: Some(1),
        start: chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
        end: chrono::NaiveTime::from_hms_opt(10, 30, 0).unwrap(),
        ..ScheduleEntry::default()
    };
    s.save_schedule(&weekly).unwrap();
    let one_off = ScheduleEntry {
        title: "Консультация".into(),
        date: Some(d(2026, 10, 27)),
        ..ScheduleEntry::default()
    };
    s.save_schedule(&one_off).unwrap();

    let week = s.week_view(d(2026, 10, 28), t(2026, 10, 26, 8, 0)).unwrap();
    assert_eq!(week.start, d(2026, 10, 26));
    assert_eq!(week.days.len(), 7);
    assert_eq!(week.days[0].entries.len(), 1);
    assert_eq!(week.days[1].entries.len(), 1);
    assert_eq!(week.days[1].entries[0].title, "Консультация");
    assert_eq!(week.days[2].entries.len(), 0);

    // следующая неделя: только еженедельное занятие
    let next = s.week_view(d(2026, 11, 2), t(2026, 10, 26, 8, 0)).unwrap();
    assert_eq!(next.days[0].entries.len(), 1);
    assert_eq!(next.days[1].entries.len(), 0);
}

// ---------- системная интеграция ----------

#[test]
fn upcoming_alarms_skip_done_and_past_and_respect_limit() {
    let s = store();
    let r = s.save_reminder(&rem("Таблетки", t(2026, 10, 26, 9, 0), Repeat::Daily)).unwrap();
    let now = t(2026, 10, 26, 8, 0);
    assert_eq!(s.upcoming_alarms(now, 2, 100).unwrap().len(), 3);

    // досрочно отметили сегодняшнее срабатывание
    s.complete(r.id, t(2026, 10, 26, 9, 0), now).unwrap();
    let alarms = s.upcoming_alarms(now, 2, 100).unwrap();
    assert_eq!(alarms.len(), 2);
    assert_eq!(alarms[0].at, t(2026, 10, 27, 9, 0));
    assert_eq!(alarms[0].key, format!("{}|2026-10-27T09:00:00", r.id));

    assert_eq!(s.upcoming_alarms(now, 2, 1).unwrap().len(), 1);
    // позже срока ничего из прошлого не планируется
    assert!(s.upcoming_alarms(t(2026, 10, 30, 12, 0), 0, 100).unwrap().is_empty());
}

#[test]
fn widget_snapshot_has_seven_days_and_theme() {
    let s = store();
    s.save_reminder(&rem("Дело", t(2026, 10, 26, 9, 0), Repeat::Daily)).unwrap();
    s.set_setting("accent", "#FF5722").unwrap();
    let snap = s.widget_snapshot(t(2026, 10, 26, 8, 0)).unwrap();
    assert_eq!(snap.days.len(), 7);
    assert_eq!(snap.days[0].date, "2026-10-26");
    assert_eq!(snap.days[0].items.len(), 1);
    assert_eq!(snap.accent, "#FF5722");
}

// ---------- API для интерфейса ----------

#[test]
fn api_roundtrip_like_the_ui_uses_it() {
    let store = Mutex::new(Store::open_in_memory().unwrap());
    let now = t(2026, 10, 26, 8, 0);

    // интерфейс присылает время без секунд
    let saved = dispatch(
        &store,
        now,
        "reminders.save",
        json!({"reminder": {
            "title": "Таблетки", "icon": "💊", "category_id": 3,
            "start": "2026-10-26T09:00", "alert": "alarm",
            "repeat": {"type": "daily"}
        }}),
    )
    .unwrap();
    assert_eq!(saved["alert"], "alarm");
    assert_eq!(saved["start"], "2026-10-26T09:00:00");
    let id = saved["id"].as_i64().unwrap();
    assert!(id > 0);

    let day = dispatch(&store, now, "day", json!({"date": "2026-10-26"})).unwrap();
    assert_eq!(day["items"].as_array().unwrap().len(), 1);
    assert_eq!(day["items"][0]["status"], "upcoming");

    let done = dispatch(
        &store,
        t(2026, 10, 26, 9, 0),
        "complete",
        json!({"reminder_id": id, "at": "2026-10-26T09:00"}),
    )
    .unwrap();
    assert_eq!(done["status"], "done_on_time");

    let stats = dispatch(&store, t(2026, 10, 26, 9, 1), "stats", json!({})).unwrap();
    assert_eq!(stats["total_done"], 1);

    assert!(dispatch(&store, now, "no.such.command", json!({})).is_err());
}

#[test]
fn settings_have_defaults_and_token_is_protected() {
    let store = Mutex::new(Store::open_in_memory().unwrap());
    let now = t(2026, 10, 26, 8, 0);
    let s = dispatch(&store, now, "settings.get", json!({})).unwrap();
    assert_eq!(s["theme"], "material");
    assert_eq!(s["online.registered"], "false");

    dispatch(&store, now, "settings.set", json!({"key": "accent", "value": "#00BCD4"})).unwrap();
    let s = dispatch(&store, now, "settings.get", json!({})).unwrap();
    assert_eq!(s["accent"], "#00BCD4");

    assert!(dispatch(&store, now, "settings.set", json!({"key": "online.token", "value": "x"})).is_err());
}
