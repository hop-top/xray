<?php
// Static forms: use, group use, use function/const, require/include literals.
namespace App\Http;

use Vendor\Pkg\Client;
use Vendor\Pkg\{Request, Response as Resp, Sub\Thing};
use function Vendor\Pkg\helper;
use const Vendor\Pkg\VERSION;

require_once __DIR__ . '/../bootstrap.php';
include 'config.php';

// References: qualified names resolved per namespace rules.
final class Controller
{
    public function handle(Request $r): Resp
    {
        $c = new Client();
        $t = new \Monolog\Logger('x');
        Sub\Thing::make();
        Models\User::find(1);
        return new Resp(helper(VERSION));
    }
}
