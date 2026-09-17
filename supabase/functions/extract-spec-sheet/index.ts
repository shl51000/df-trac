// Reads a handloom design spec-sheet photo and returns its fields as JSON,
// for the Design Library's "Upload Spec Sheet" flow to prefill the manual
// entry form for review — nothing is ever saved without a look first.
//
// Runs server-side (not in the browser) specifically so the Anthropic API
// key stays a Supabase secret and is never shipped to the client. Deploy
// with:
//   supabase functions deploy extract-spec-sheet
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Until deployed, the client-side upload flow calls this and fails
// gracefully (same as it always did when the AI read couldn't be trusted)
// — the photo is still kept, the form just isn't pre-filled.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SCHEMA_HINT =
  '{"designNo":"MS-147","hooks":"2640","reed":"96","panno":"48\\"","materialType":"","cutSize":"3.66","pickValues":["60","56"],"feeders":[{"feeder":1,"card":"840","picks":{"60":"60.00","56":"56.00"}}]}'

const SYSTEM_PROMPT = `You read handloom design specification sheets and return ONLY valid JSON — no markdown fences, no commentary. Match this exact shape: ${SCHEMA_HINT}. Read DESIGN NO, HOOK, REED and PANNO from the header. The field labelled TOTAL CUT (sometimes just CUT) on the sheet is the Cut Size — read its number into "cutSize" exactly as printed; it applies to the whole design, not per feeder. If the sheet also names a Material Type elsewhere, read that once into "materialType", also for the whole design. If TOTAL CUT isn't shown anywhere on the sheet, default cutSize to "1" rather than leaving it blank. The PICK row and the FEEDER table share the same base pick values (e.g. 60 and 56) as separate columns — list those values, in the order shown, as "pickValues". For each of the 8 feeder rows (F1-F8) read the CARD number and that feeder's PICK value under each pick-value column, exactly as printed (keep trailing zeros as printed, e.g. "60.00"). Do not read the COLOUR column. If a feeder row is blank or shows "-", use an empty string for card and "0" for its picks. If any field is unreadable, use an empty string rather than guessing.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const { imageBase64, mediaType } = await req.json()
    if (!imageBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: 'imageBase64 and mediaType are required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: 'Extract this design spec sheet as JSON matching the schema.' },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      return new Response(JSON.stringify({ error: `Anthropic request failed (${response.status})`, detail }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const textBlock = (data.content || []).find((b) => b.type === 'text')
    if (!textBlock) throw new Error('No response text from model')
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
    const extracted = JSON.parse(cleaned)

    return new Response(JSON.stringify(extracted), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
