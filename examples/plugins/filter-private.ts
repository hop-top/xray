import { XrayPlugin } from '../../src/lib/events/plugin';
import { Xray } from '../../src/lib/xray';

/**
 * FilterPrivatePlugin - Filters out private functions/methods from analysis
 *
 * Removes tags that start with an underscore (e.g., _privateFunction)
 * Tracks and reports the number of filtered items
 */
export class FilterPrivatePlugin implements XrayPlugin {
  name = 'filter-private';
  version = '1.0.0';

  private filtered: number = 0;

  apply(xray: Xray): void {
    xray.on('parse:after', (event) => {
      const before = event.tags.length;
      event.tags = event.tags.filter(tag => !tag.name.startsWith('_'));
      this.filtered += (before - event.tags.length);
    });

    xray.on('render:start', () => {
      if (this.filtered > 0) {
        const word = this.filtered === 1 ? 'function' : 'functions';
        console.log(`Filtered ${this.filtered} private ${word}`);
      }
    });
  }
}
