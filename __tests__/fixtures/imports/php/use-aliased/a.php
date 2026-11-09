<?php
namespace App\Http;

use Foo\Bar;
use \Foo\Baz as Q, Other;
use Vendor\Pkg\Thing as Chose; // é 🚀

class C {
    use SomeTrait;
}
$fn = function () use ($x) {};

namespace App\Other {
}
