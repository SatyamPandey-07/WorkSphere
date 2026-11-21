import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const OFFLINE_QUEUE_KEY = "@worksphere_offline_tickets";

export default function CreateTicketScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected;
      setIsOnline(connected);
      if (connected) {
        syncOfflineQueue();
      }
    });
    return () => unsubscribe();
  }, []);

  const syncOfflineQueue = async () => {
    try {
      const storedQueue = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!storedQueue) return;

      const tickets = JSON.parse(storedQueue);
      if (tickets.length === 0) return;

      console.log(`?? Syncing ${tickets.length} offline tickets to Supabase...`);

      // Process and flush offline queue
      for (const ticket of tickets) {
        await fetch("/api/tickets/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ticket),
        });
      }

      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
      Alert.alert("Success", "All offline tickets successfully synced!");
    } catch (error) {
      console.error("Failed to sync offline queue:", error);
    }
  };

  const handleTicketSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    const newTicket = { title, description, createdAt: new Date().toISOString() };

    if (!isOnline) {
      try {
        const storedQueue = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
        const tickets = storedQueue ? JSON.parse(storedQueue) : [];
        tickets.push(newTicket);
        await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(tickets));
        Alert.alert("Offline Mode", "Ticket saved locally. Will sync automatically when online.");
        setTitle("");
        setDescription("");
      } catch (err) {
        Alert.alert("Error", "Failed to save ticket offline.");
      }
      return;
    }

    try {
      const response = await fetch("/api/tickets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTicket),
      });

      if (response.ok) {
        Alert.alert("Success", "Ticket created successfully.");
        setTitle("");
        setDescription("");
      } else {
        throw new Error("Server error");
      }
    } catch (err) {
      Alert.alert("Error", "Network request failed. Saving to offline queue.");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Create Support Ticket</Text>
      <Text style={styles.status}>Status: {isOnline ? "?? Online" : "?? Offline"}</Text>

      <TextInput
        style={styles.input}
        placeholder="Ticket Title"
        placeholderTextColor="#888"
        value={title}
        onChangeText={setTitle}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Describe your issue..."
        placeholderTextColor="#888"
        multiline
        value={description}
        onChangeText={setDescription}
      />

      <TouchableOpacity style={styles.button} onPress={handleTicketSubmit}>
        <Text style={styles.buttonText}>Submit Ticket</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#0f172a" },
  header: { fontSize: 22, fontWeight: "bold", color: "#f8fafc", marginBottom: 10 },
  status: { fontSize: 14, color: "#38bdf8", marginBottom: 20 },
  input: { backgroundColor: "#1e293b", color: "#fff", padding: 12, borderRadius: 8, marginBottom: 15 },
  textArea: { height: 120, textAlignVertical: "top" },
  button: { backgroundColor: "#6366f1", padding: 15, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
});
