use super::proto;
pub struct Conn;
// Unsupported: code and data pulled in by path.
include!(concat!(env!("OUT_DIR"), "/gen.rs"));
pub const CA: &str = include_str!("ca.pem");
