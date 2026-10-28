//! Ядро ежедневника. Не зависит от UI и платформы: одно и то же ядро
//! работает в Android-приложении и в будущей Windows-версии.

pub mod achievements;
pub mod api;
pub mod error;
pub mod model;
pub mod online;
pub mod planner;
pub mod recurrence;
pub mod store;
pub mod timefmt;

pub use error::{Error, Result};
pub use store::Store;
