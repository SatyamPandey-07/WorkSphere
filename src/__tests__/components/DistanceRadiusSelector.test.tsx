import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "@/components/chat/ChatMessages";

// Mock dependencies
jest.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isSupported: true,
    status: "idle",
    errorMessage: "",
    startListening: jest.fn(),
    stopListening: jest.fn(),
  }),
}));

jest.mock("@/hooks/useRateLimit", () => ({
  useRateLimit: () => 0,
}));

describe("ChatInput with DistanceRadiusSelector", () => {
  it("renders the distance radius selector with all options", () => {
    const handleInputChange = jest.fn();
    const handleSubmit = jest.fn();
    const handleDistanceChange = jest.fn();

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        distanceRadius={0}
        onDistanceChange={handleDistanceChange}
      />,
    );

    const select = screen.getByTitle("Filter by distance");
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent("Any");
    expect(options[1]).toHaveTextContent("1 km");
    expect(options[2]).toHaveTextContent("5 km");
    expect(options[3]).toHaveTextContent("10 km");
  });

  it("calls onDistanceChange when an option is selected", () => {
    const handleInputChange = jest.fn();
    const handleSubmit = jest.fn();
    const handleDistanceChange = jest.fn();

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        distanceRadius={0}
        onDistanceChange={handleDistanceChange}
      />,
    );

    const select = screen.getByTitle("Filter by distance");

    // Select 5 km
    fireEvent.change(select, { target: { value: "5" } });

    expect(handleDistanceChange).toHaveBeenCalledTimes(1);
    expect(handleDistanceChange).toHaveBeenCalledWith(5);
  });
});
