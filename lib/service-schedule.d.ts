export type ServiceScheduleEntry = {
  day: string;
  enabled: boolean;
  start: string;
  end: string;
};

export function isServiceOpen(schedule: ServiceScheduleEntry[], now?: Date): boolean;
