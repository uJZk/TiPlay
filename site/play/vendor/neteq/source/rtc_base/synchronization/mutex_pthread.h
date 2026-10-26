#pragma once
// Each WASM instance is owned exclusively by one AudioWorklet thread.
namespace webrtc { class MutexImpl { public: void Lock() {} bool TryLock() { return true; } void AssertHeld() const {} void Unlock() {} }; }
