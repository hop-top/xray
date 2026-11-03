use std::fmt;
use ::serde_json;
use ::serde::{Serialize, de::*};
use crate::a::b as c;
use super::*;
use self::x::{y::*, z};
pub(crate) use crate::config::Config;
#[cfg(test)]
use std::collections::HashMap;

fn f() {
    use std::io::Write;
}

mod inline {
    use super::fmt as fmt2;
}
