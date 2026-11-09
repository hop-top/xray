//! Static forms: use trees, extern crate, mod declarations.
extern crate alloc;

mod net;
#[path = "gen/proto.rs"]
mod proto;

use std::collections::{HashMap, HashSet as Set};
use crate::net::{self, Conn};
use ::serde_json::Value;
use tokio::*;

// References: path roots used without a `use`.
#[tokio::main]
async fn main() {
    let v: Value = serde_json::from_str("{}").unwrap();
    let _ = (HashMap::<u8, u8>::new(), Set::<u8>::new(), v, anyhow::anyhow!("x"));
    log::info!("{}", chrono::Utc::now());
}
