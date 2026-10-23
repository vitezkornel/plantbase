import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventLog } from './event-log';

describe('EventLog', () => {
  it('should say so when there is nothing yet', () => {
    expect(renderToStaticMarkup(<EventLog lines={[]} />)).toContain(
      'Még nincs esemény',
    );
  });

  it('should list the lines and label demo lines', () => {
    const markup = renderToStaticMarkup(
      <EventLog
        lines={[
          { id: 1, kind: 'barge-in', text: 'Közbevágás', demo: false },
          { id: 2, kind: 'tool', text: 'Tool-hívás: getOrderStatus', demo: true },
        ]}
      />,
    );

    expect(markup).toContain('Közbevágás');
    expect(markup).toContain('Tool-hívás: getOrderStatus');
    expect(markup.match(/DEMO/g)).toHaveLength(1);
  });

  it('should escape model-controlled text', () => {
    const markup = renderToStaticMarkup(
      <EventLog
        lines={[{ id: 1, kind: 'error', text: '<img src=x onerror=1>', demo: false }]}
      />,
    );

    expect(markup).not.toContain('<img');
  });
});
