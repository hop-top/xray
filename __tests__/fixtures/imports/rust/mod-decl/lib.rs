mod a;
pub mod b;
#[path = "gen/é.rs"]
mod generated;
#[cfg(unix)]
// comment between attributes
#[path = "sys/unix.rs"]
mod sys;
mod inline {
    mod nested;
}
#[cfg(test)]
mod tests;
