async function testAPI() {
  const request = {
    destination: "Paris",
    numberOfDays: 3,
    budgetInr: 100000,
    numberOfTravellers: 2,
    interests: ["Art", "Food"],
    accommodationPreference: "Moderate",
    activityLevel: "Moderate",
    additionalNotes: ""
  };

  try {
    const res = await fetch("http://localhost:5000/api/generate-travel-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request)
    });
    console.log(`HTTP Status: ${res.status}`);
    const data = await res.json();
    console.log(`Success: ${data.success}`);
    console.log(`isDemo: ${data.isDemo}`);
    console.log(`Message: ${data.message}`);
    console.log(`Plan Places: ${data.data?.placesToVisit?.length || 0}`);
  } catch (e) {
    console.error("Test failed", e);
  }
}
testAPI();
