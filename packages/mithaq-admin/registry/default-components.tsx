import { ButtonGroupControl, CheckboxGroupControl, ComboboxControl, RadioControl, SelectControl, ToggleGroupControl } from './choice-control.tsx'
import { CheckboxControl, SwitchControl, ToggleControl } from './checkbox-control.tsx'
import type { Components } from './components.tsx'
import { CalendarControl, DatePicker } from './date-control.tsx'
import { NumberControl, SliderControl } from './number-control.tsx'
import { RelationshipControl } from './relationship-control.tsx'
import { RichTextControl } from './rich-text.tsx'
import { DecimalControl, EmailControl, OtpControl, ReadOnlyControl, TextControl } from './text-control.tsx'
import { TextArrayControl, TextareaControl } from './textarea-control.tsx'
import { UploadControl } from './upload.tsx'

// Apart from the provider, so a control that reads the map imports no other control.
export const defaultComponents: Components = {
  controls: {
    combobox: ComboboxControl,
    otp: OtpControl,
    slider: SliderControl,
    // `nativeSelect` draws the same shadcn select, so two boxes over one kind of choice never differ in their border.
    nativeSelect: SelectControl,
    select: SelectControl,
    toggleGroup: ToggleGroupControl,
    radio: RadioControl,
    switch: SwitchControl,
    text: TextControl,
    email: EmailControl,
    number: NumberControl,
    integer: NumberControl,
    decimal: DecimalControl,
    datetime: DatePicker,
    // A calendar day reports the `yyyy-mm-dd` the column holds and never goes through a moment, which would move the day.
    date: DatePicker,
    checkbox: CheckboxControl,
    textArray: TextArrayControl,
    uuid: ReadOnlyControl,
    relationship: RelationshipControl,
    upload: UploadControl,
    richText: RichTextControl,
    textarea: TextareaControl,
    toggle: ToggleControl,
    buttonGroup: ButtonGroupControl,
    checkboxGroup: CheckboxGroupControl,
    calendar: CalendarControl,
  },
}
