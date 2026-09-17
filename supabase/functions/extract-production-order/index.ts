// Reads a Production Order screenshot/photo and returns its fields as JSON,
// for the "Upload Screenshot" flow to prefill the manual entry form for
// review — nothing is ever saved without a look first. Same pattern as
// extract-spec-sheet (see that function for the deploy steps and the
// graceful-degradation note); this one just reads a different sheet shape.
//
// Deploy with:
//   supabase functions deploy extract-production-order
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (shared with extract-spec-sheet)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SCHEMA_HINT =
  '{"poNo":"2219","poDate":"2026-09-09","width":"48","designNo":"MS-147","pick":"56","warpYarnQuality":"30S KOTA BLACK","feederQuality":[{"feeder":1,"yarnQuality":"30 S EXCEL"}],"lines":[{"sl":1,"colours":[{"feeder":1,"colourText":"MEROON 1606B"}],"qty":"200"}]}'

const SYSTEM_PROMPT = `You read handloom production order sheets and return ONLY valid JSON — no markdown fences, no commentary. Match this exact shape: ${SCHEMA_HINT}. Read the order/PO number, the order date (convert it to YYYY-MM-DD), the width, and the design number. Also read the base Pick value shown near the top of the sheet (often labelled "PICK" or "PICK (GROUND)") as "pick" — this single number is NOT the same as the per-row quantities inside the feeder/colourway table further down, and the same design number can exist at more than one base Pick, so read it carefully. If a base/warp yarn (often labelled "BASE WARP" or similar) is shown, read its full text as "warpYarnQuality" — it usually includes both a yarn quality and a colour in one phrase. Each feeder has one yarn quality text (e.g. "30 S EXCEL", "150 POLY", "JARI") that stays the same for every colourway — list that once per feeder in "feederQuality". Then list every colourway row as an entry in "lines": a serial number, the colour/shade text for each feeder in that row, and the quantity in metres for that row. If a field is unreadable, use an empty string rather than guessing.`

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
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: 'Extract this production order as JSON matching the schema.' },
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
