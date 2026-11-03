<?php
require 'a.php';
require_once("b.php");
include "c.php";
include_once __DIR__ . '/../d.php';
include_once(__DIR__ . "/é.php");
$x = require __DIR__ . 'nodir.php';
require "esc\\aped.php";
require 'it\'s.php';
include "$p.php";
require $p;
require dirname(__FILE__) . '/x.php';
