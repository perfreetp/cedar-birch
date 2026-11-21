import type { JSX } from 'solid-js';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}

export function SliderRow(props: SliderRowProps): JSX.Element {
  return (
    <label class="slider-row">
      <span class="slider-label">
        {props.label}
        {props.hint && <em class="slider-hint">{props.hint}</em>}
      </span>
      <span class="slider-control">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        />
        <output>
          {props.value.toFixed(props.step < 1 ? 2 : 0)}
          {props.unit ?? ''}
        </output>
      </span>
    </label>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleRow(props: ToggleRowProps): JSX.Element {
  return (
    <label class="toggle-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}
