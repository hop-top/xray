<?php
namespace App\Http;

use Vendor\Pkg as P, Other\Lib;
use function Fn\helper;

#[\Attr\Route('/x')]
class C extends Base\Ctl implements \Vendor\Pkg\Iface {
    use \Traits\T;

    public function f(\Vendor\Pkg\Thing $t): P\Res {
        new \Vendor\Pkg\Thing();
        P\Factory::make();
        lib\x\fn_call();
        namespace\Sub\K::class;
        $a instanceof Models\User;
        helper\nested();
        new Foo();
        return \Vendor\Pkg\Thing::X;
    }
}

namespace Second;

$x = new Lib\Other();
