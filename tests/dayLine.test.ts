import { describe, expect, it } from 'vitest';
import { dayWindow, hourTicks, labelSpots, toMin } from '../src/pages/dayLine';

describe('day line', () => {
  it('spans 8 h to 22 h on an ordinary day', () => {
    expect(dayWindow([toMin('10:00')], [toMin('12:00')], toMin('14:44'))).toEqual({ from: 480, to: 1320 });
    expect(hourTicks(480, 1320).map(m => m / 60)).toEqual([8, 12, 16, 20, 22]);
  });
  it('grows to include an early event, a late one and the time now', () => {
    expect(dayWindow([toMin('06:30')], [toMin('23:15')], toMin('12:00'))).toEqual({ from: 360, to: 1440 });
    expect(dayWindow([], [], toMin('01:20'))).toEqual({ from: 60, to: 1320 });
    expect(dayWindow([], [], toMin('23:40'))).toEqual({ from: 480, to: 1440 });
  });
  it('a long day gets marks every 6 hours, and no mark crowds the end', () => {
    expect(hourTicks(360, 1440).map(m => m / 60)).toEqual([6, 12, 18, 24]);
    expect(hourTicks(480, 1440).map(m => m / 60)).toEqual([8, 12, 16, 20, 24]);
    expect(hourTicks(480, 1380).map(m => m / 60)).toEqual([8, 12, 16, 20, 23]);
  });
});

describe('names on the day line', () => {
  it('far apart: one line, each up to the next', () => {
    expect(labelSpots([20, 50])).toEqual([
      { row: 0, align: 'start', max: 29 },
      { row: 0, align: 'start', max: 48 },
    ]);
  });
  it('close together: the second goes on the line above', () => {
    const s = labelSpots([40, 50, 70]);
    expect(s.map(x => x.row)).toEqual([0, 1, 0]);
    expect(s[0].max).toBe(29);
  });
  it('the last one near the right edge ends at its dot and shares the room with the one before', () => {
    expect(labelSpots([30, 92])).toEqual([
      { row: 0, align: 'start', max: 30 },
      { row: 0, align: 'end', max: 30 },
    ]);
    expect(labelSpots([92])).toEqual([{ row: 0, align: 'end', max: 48 }]);
  });
  it('four events within three hours: three lines, nothing overlaps', () => {
    const s = labelSpots([57.9, 72.1, 75.7, 88.8]);
    expect(s.map(x => x.row)).toEqual([0, 1, 2, 0]);
    // dentiste (start, from 57.9) and Dîner (end, up to 88.8) share their line without overlapping.
    expect(57.9 + s[0].max).toBeLessThanOrEqual(88.8 - s[3].max);
  });
});
