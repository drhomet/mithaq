import { cells } from 'mithaq-admin/cells.tsx'
import { ButtonGroupControl, CheckboxGroupControl, ComboboxControl, RadioControl, SelectControl, ToggleGroupControl } from 'mithaq-admin/choice-control.tsx'
import { CheckboxControl, SwitchControl, ToggleControl } from 'mithaq-admin/checkbox-control.tsx'
import type { Components } from 'mithaq-admin/components.tsx'
import { CalendarControl, DatePicker } from 'mithaq-admin/date-control.tsx'
import { defaultNodes } from 'mithaq-admin/default-nodes.tsx'
import { IntegerControl, NumberControl, SliderControl } from 'mithaq-admin/number-control.tsx'
import { RelationshipControl } from 'mithaq-admin/relationship-control.tsx'
import { DecimalControl, EmailControl, OtpControl, ReadOnlyControl, TextControl } from 'mithaq-admin/text-control.tsx'
import { JsonControl, TextArrayControl, TextareaControl } from 'mithaq-admin/textarea-control.tsx'

// Apart from the provider, so a control that reads the map imports no other control. Rich text and files are not
// here: `richTextComponents` and `uploadComponents` are spread in by a language that holds their kinds.
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
    integer: IntegerControl,
    decimal: DecimalControl,
    datetime: DatePicker,
    // A calendar day reports the `yyyy-mm-dd` the column holds and never goes through a moment, which would move the day.
    date: DatePicker,
    checkbox: CheckboxControl,
    textArray: TextArrayControl,
    uuid: ReadOnlyControl,
    json: JsonControl,
    relationship: RelationshipControl,
    textarea: TextareaControl,
    toggle: ToggleControl,
    buttonGroup: ButtonGroupControl,
    checkboxGroup: CheckboxGroupControl,
    calendar: CalendarControl,
  },
  cells,
  nodes: defaultNodes,
}
