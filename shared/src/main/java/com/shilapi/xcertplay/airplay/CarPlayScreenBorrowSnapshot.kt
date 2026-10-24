package com.shilapi.xcertplay.airplay

/** Local ownership evidence; session identity is never part of browser status or diagnostics. */
class CarPlayScreenBorrowSnapshot internal constructor(
    internal val session: AirPlaySession,
    val state: CarPlayScreenBorrowState,
)
