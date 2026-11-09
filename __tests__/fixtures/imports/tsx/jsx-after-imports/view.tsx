import React from 'react';
const App = () => <div className="x">it's {1 < 2 ? <b>a</b> : null}</div>;
import { later } from './later';
import type { Props } from './props';
export function View(p: Props) { return <App {...p} />; }
export { Button } from './button';
