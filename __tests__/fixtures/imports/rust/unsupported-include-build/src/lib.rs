include!(concat!(env!("OUT_DIR"), "/generated.rs"));
include!("manual.rs");

pub const SCHEMA: &str = include_str!("../schema.json");
pub const LOGO: &[u8] = std::include_bytes!("logo.png");
