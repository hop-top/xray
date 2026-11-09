<?php
namespace App;

use App\Lib\Thing;

require __DIR__ . '/lib/a.php';
require_once 'lib/b.php';
include './lib/a.php';
include 'missing.php';
include '/etc/php/x.php';
