<?php
// Unsupported: eval, computed include, class and callable names at run time.
namespace App;

$cls = $_GET['c'];
eval('$x = 1;');
include $cls . '.php';
$o = new $cls();
$cls::boot();
call_user_func($cls);
$f = 'strlen';
$f('x');
