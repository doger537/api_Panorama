# Frontend feature boundaries

Add organizer, plan, panorama, capture and visitor features as separate directories. Each feature exports an `index.ts`; feature code consumes `src/shared` and `CONTRACTS/types.ts` and does not edit the app shell or package manifest.
