import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput } from "./controls";

describe("non-positive size validation", () => {
  it("rejects zero and does not report it upstream", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} suffix="mm" />);

    const input = screen.getByLabelText(/Width/);
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(screen.getByRole("alert")).toHaveTextContent("Must be greater than 0");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a negative size", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} />);

    const input = screen.getByLabelText(/Width/);
    await userEvent.clear(input);
    await userEvent.type(input, "-15");

    expect(screen.getByRole("alert")).toHaveTextContent("Must be greater than 0");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects an empty value", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} />);

    await userEvent.clear(screen.getByLabelText(/Width/));

    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restores the last valid value when a rejected entry loses focus", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} />);

    const input = screen.getByLabelText(/Width/) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "-15");
    await userEvent.tab();

    expect(input.value).toBe("120");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a positive size", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} />);

    const input = screen.getByLabelText(/Width/);
    await userEvent.clear(input);
    await userEvent.type(input, "150");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(150);
  });

  it("accepts a positive fraction", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Thickness" value={1} onChange={onChange} />);

    const input = screen.getByLabelText(/Thickness/);
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });

  it("allows zero for offsets, where allowMin is set", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="X" value={10} onChange={onChange} min={0} allowMin />);

    const input = screen.getByLabelText(/X/);
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("rejects a count below one", async () => {
    const onChange = vi.fn();
    render(
      <NumberInput
        label="How many labels"
        value={10}
        onChange={onChange}
        min={1}
        max={5000}
        integer
        allowMin
      />
    );

    const input = screen.getByLabelText(/How many labels/);
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(screen.getByRole("alert")).toHaveTextContent("Must be 1 or more");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a fractional count and never commits the fraction", async () => {
    const onChange = vi.fn();
    render(
      <NumberInput label="Count" value={10} onChange={onChange} min={1} integer allowMin />
    );

    const input = screen.getByLabelText(/Count/);
    await userEvent.clear(input);
    await userEvent.type(input, "2.5");

    expect(screen.getByRole("alert")).toHaveTextContent("Whole numbers only");
    // Typing passes through the valid prefix "2", so the field does report
    // values — but never a fractional one.
    for (const [committed] of onChange.mock.calls) {
      expect(Number.isInteger(committed)).toBe(true);
    }
    expect(onChange).not.toHaveBeenCalledWith(2.5);
  });

  it("rejects a value above the maximum and never commits one", async () => {
    const onChange = vi.fn();
    render(
      <NumberInput label="Count" value={10} onChange={onChange} min={1} max={5000} integer allowMin />
    );

    const input = screen.getByLabelText(/Count/);
    await userEvent.clear(input);
    await userEvent.type(input, "9000");

    expect(screen.getByRole("alert")).toHaveTextContent("Must be 5000 or less");
    for (const [committed] of onChange.mock.calls) {
      expect(committed).toBeLessThanOrEqual(5000);
    }
  });

  it("reverts to the value it started from, not to a digit typed en route", async () => {
    // Guards a real trap: typing "9000" into a field capped at 5000 commits
    // 9, 90 and 900 on the way. Blur must restore 10, not leave 900 behind.
    const onChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState(10);
      return (
        <NumberInput
          label="Count"
          value={value}
          min={1}
          max={5000}
          integer
          allowMin
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    };
    render(<Harness />);

    const input = screen.getByLabelText(/Count/) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "9000");
    await userEvent.tab();

    expect(input.value).toBe("10");
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never scrubs a size down to zero or below", () => {
    // Scrubbing commits values without going through validate(), so the clamp
    // is the only thing standing between a hard drag and a zero-width label.
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={5} onChange={onChange} step={0.1} />);

    const handle = screen.getByText("Width");
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    // Drag far enough left to drive the value well below zero if unclamped.
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 0, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
    for (const [committed] of onChange.mock.calls) {
      expect(committed).toBeGreaterThan(0);
    }
  });

  it("never scrubs a count below its minimum or above its maximum", () => {
    const onChange = vi.fn();
    render(
      <NumberInput
        label="Count"
        value={50}
        onChange={onChange}
        min={1}
        max={5000}
        step={1}
        integer
        allowMin
      />
    );

    const handle = screen.getByText("Count");
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -9000, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 90000, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 90000, pointerId: 1 });

    for (const [committed] of onChange.mock.calls) {
      expect(committed).toBeGreaterThanOrEqual(1);
      expect(committed).toBeLessThanOrEqual(5000);
      expect(Number.isInteger(committed)).toBe(true);
    }
  });

  it("does not scrub when scrubbing is disabled", () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={5} onChange={onChange} noScrub />);

    const handle = screen.getByText("Width");
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 700, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects text that is not a number", async () => {
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={120} onChange={onChange} />);

    const input = screen.getByLabelText(/Width/) as HTMLInputElement;
    // A number input drops non-numeric keystrokes, leaving the field empty;
    // either way the value must not reach the design.
    await userEvent.clear(input);
    await userEvent.type(input, "abc");

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
