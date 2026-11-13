import { create } from 'zustand';

/** How many dialogs (components/Overlays › Modal) are open: what is behind them is made inert (the calendar's quick add). */
export const useModals = create<{ open: number }>(() => ({ open: 0 }));
