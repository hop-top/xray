<?php
namespace App;

require __DIR__ . '/bootstrap.php';
require $config['path'];
include "plugins/$name.php";

eval($code);

$handler = new $class($args);
$other = new ('App\\' . $kind);
$model = $repo::find(1);

$fn($x);
call_user_func($callback, $x);
call_user_func('strlen', $x);
