use std::collections::hash_map;
use anyhow::{self, Context as _};
extern crate rand as rng;
mod util;

fn encode(v: &Value) -> String {
    let s = serde_json::to_string(v).unwrap();
    let _ = serde_json::from_str::<Value>(&s);
    let m: hash_map::HashMap<u8, u8> = Default::default();
    let _ = u32::MAX + Self::LIMIT + Option::<u8>::None.unwrap_or(0) as u32;
    let _ = util::helper() + rng::random::<u8>() + local::f();
    let _: anyhow::Result<()> = Ok(());
    std::mem::drop(m);
    crate::util::x(); self::y(); super::z();
    s
}

fn local() {}
mod local { pub fn f() {} }

impl tokio::io::AsyncRead for Reader {}
type Out = <Reader as futures::io::AsyncBufRead>::Item;

pub fn root() -> ::bytes::Bytes { log::info!("x"); ::bytes::Bytes::new() }
