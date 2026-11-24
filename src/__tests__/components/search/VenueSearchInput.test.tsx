
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { VenueSearchInput } from "@/components/search/VenueSearchInput";

describe("VenueSearchInput component", () => {
  it("renders input field with keyboard shortcut badge by default", () => {
    render(<VenueSearchInput aria-label="Search venues" />);
    const input = screen.getByLabelText("Search venues");
    expect(input).toBeInTheDocument();
    expect(screen.getByTestId("search-shortcut-badge")).toBeInTheDocument();
  });

  it("does not display amenity suggestions when hasZeroResults is false", () => {
    render(
      <VenueSearchInput
        aria-label="Search venues"
        value="wifii"
        hasZeroResults={false}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByTestId("amenity-suggestions")).not.toBeInTheDocument();
  });

  it('displays "Did you mean: wifi?" suggestion chip when query is "wifii" and hasZeroResults is true', () => {
    render(
      <VenueSearchInput
        aria-label="Search venues"
        value="wifii"
        hasZeroResults={true}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId("amenity-suggestions")).toBeInTheDocument();
    expect(screen.getByText("Did you mean:")).toBeInTheDocument();

    const chip = screen.getByTestId("amenity-suggestion-wifi");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("wifi?");
  });

  it("displays suggestion chip when resultCount is 0 or 1 (low results)", () => {
    const { rerender } = render(
      <VenueSearchInput
        aria-label="Search venues"
        value="outlett"
        resultCount={0}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId("amenity-suggestion-outlet")).toBeInTheDocument();

    rerender(
      <VenueSearchInput
        aria-label="Search venues"
        value="outlett"
        resultCount={1}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("amenity-suggestion-outlet")).toBeInTheDocument();
  });

  it("automatically re-executes search and updates input when clicking suggestion chip", () => {
    const onSelectSuggestion = jest.fn();
    const onChange = jest.fn();
    const onSubmit = jest.fn((e) => e.preventDefault());
    const inputRef = React.createRef<HTMLInputElement>();

    render(
      <form onSubmit={onSubmit}>
        <VenueSearchInput
          ref={inputRef}
          aria-label="Search venues"
          value="wifii"
          hasZeroResults={true}
          onChange={onChange}
          onSelectSuggestion={onSelectSuggestion}
        />
      </form>,
    );

    const chip = screen.getByTestId("amenity-suggestion-wifi");
    fireEvent.click(chip);

    // 1. Calls onSelectSuggestion with corrected amenity
    expect(onSelectSuggestion).toHaveBeenCalledWith("wifi");

    // 2. Calls onChange with synthetic event containing 'wifi'
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].target.value).toBe("wifi");

    // 3. Updates inputRef value and submits form to re-execute search
    expect(inputRef.current?.value).toBe("wifi");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("re-executes search via form submission even when no external ref is passed", () => {
    const onSubmit = jest.fn((e) => e.preventDefault());
    const onChange = jest.fn();

    render(
      <form onSubmit={onSubmit}>
        <VenueSearchInput
          aria-label="Search venues"
          value="outlett"
          hasZeroResults={true}
          onChange={onChange}
        />
      </form>,
    );

    const chip = screen.getByTestId("amenity-suggestion-outlet");
    fireEvent.click(chip);

    expect(onChange).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalled();
  });

  it('suggests "ergonomic chair" for "ergonmic chair" typo within edit distance 2', () => {
    render(
      <VenueSearchInput
        aria-label="Search venues"
        value="ergonmic chair"
        hasZeroResults={true}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByTestId("amenity-suggestion-ergonomic chair"),
    ).toBeInTheDocument();
  });

  it("hides shortcut badge when input has a value or is focused", () => {
    const { rerender } = render(
      <VenueSearchInput
        aria-label="Search venues"
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("search-shortcut-badge")).toBeInTheDocument();

    // With value
    rerender(
      <VenueSearchInput
        aria-label="Search venues"
        value="meeting"
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("search-shortcut-badge"),
    ).not.toBeInTheDocument();

    // When focused with empty value
    rerender(
      <VenueSearchInput
        aria-label="Search venues"
        value=""
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Search venues");
    fireEvent.focus(input);
    expect(
      screen.queryByTestId("search-shortcut-badge"),
    ).not.toBeInTheDocument();

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VenueSearchInput } from '@/components/search/VenueSearchInput';

describe('VenueSearchInput', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('submits search query with active amenities and handles storage errors gracefully', () => {
    const onQueryParamsChange = jest.fn();
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    render(
      <VenueSearchInput
        existingSearchParams="sort=rating"
        activeAmenities={['outdoorPatio']}
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const input = screen.getByTestId('venue-search-input');
    fireEvent.change(input, { target: { value: '  quiet cafe  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'sort=rating&q=quiet+cafe&amenities=outdoorPatio'
    );
    setItemSpy.mockRestore();

  });
});
