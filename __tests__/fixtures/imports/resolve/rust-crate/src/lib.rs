extern crate alloc;
extern crate log;

mod net;
mod util;
#[path = "gen/out.rs"]
mod generated;
mod absent;

use std::fmt;
use serde::Serialize;
use util::helper;
use crate::net::Client;
