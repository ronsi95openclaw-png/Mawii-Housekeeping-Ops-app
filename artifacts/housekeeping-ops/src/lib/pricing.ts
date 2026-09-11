/**
 * Mawii charges a flat hourly rate, and each add-on is half an hour of extra work.
 * Change these two numbers and every quote in the app follows.
 */
export const HOURLY_RATE = 35;
export const ADD_ON_MINUTES = 30;
export const ADD_ON_PRICE = (HOURLY_RATE / 60) * ADD_ON_MINUTES;

export const ADD_ON_OPTIONS = ['Laundry', 'Inside Oven', 'Inside Fridge', 'Inside Cabinets'];

export function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export function addOnTotals(addOns: string[] | undefined | null) {
  const count = addOns?.length ?? 0;
  return { count, minutes: count * ADD_ON_MINUTES, amount: count * ADD_ON_PRICE };
}
