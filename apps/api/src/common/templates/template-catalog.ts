export const TEMPLATE_CHORES = [
  { title_en: 'Take out trash', title_he: 'להוציא את הזבל', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', dueTime: '20:00', gracePeriodMinutes: 60 } },
  { title_en: 'Wash dishes', title_he: 'לשטוף כלים', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=DAILY', dueTime: '19:30', gracePeriodMinutes: 60 } },
  { title_en: 'Fold laundry', title_he: 'לקפל כביסה', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=SU,WE', dueTime: '18:00', gracePeriodMinutes: 60 } },
  { title_en: 'Vacuum living room', title_he: 'לשאוב סלון', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=FR', dueTime: '12:00', gracePeriodMinutes: 90 } },
  { title_en: 'Clean bathrooms', title_he: 'לנקות אמבטיות', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=TH', dueTime: '17:00', gracePeriodMinutes: 120 } },
  { title_en: 'Tidy playroom', title_he: 'לסדר חדר משחקים', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=DAILY', dueTime: '20:30', gracePeriodMinutes: 45 } },
  { title_en: 'Water plants', title_he: 'להשקות צמחים', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=TU,SA', dueTime: '08:00', gracePeriodMinutes: 60 } },
  { title_en: 'Wipe kitchen counters', title_he: 'לנקות שיש במטבח', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=DAILY', dueTime: '21:00', gracePeriodMinutes: 60 } },
  { title_en: 'Feed pets', title_he: 'להאכיל חיות מחמד', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=DAILY', dueTime: '07:30', gracePeriodMinutes: 30 } },
  { title_en: 'Prepare school bags', title_he: 'להכין תיקים לבית ספר', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH', dueTime: '20:00', gracePeriodMinutes: 30 } },
  { title_en: 'Empty dishwasher', title_he: 'לרוקן מדיח', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=DAILY', dueTime: '08:30', gracePeriodMinutes: 90 } },
  { title_en: 'Mop floors', title_he: 'לשטוף רצפה', scheduleJson: { type: 'repeating_calendar', rrule: 'FREQ=WEEKLY;BYDAY=WE', dueTime: '18:30', gracePeriodMinutes: 120 } },
] as const;
