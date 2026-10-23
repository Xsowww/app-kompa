import { describe, expect, it } from 'vitest';
import { dayWindow, hourTicks, toMin } from '../src/pages/dayLine';

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
