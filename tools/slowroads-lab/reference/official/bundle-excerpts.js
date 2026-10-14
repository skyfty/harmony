// slowroads.io shipped bundle excerpts (DevMidlineGenerator chunk, minified).
// Source: %TEMP%/sr/js/chunks__DevMidlineGenerator.7013ef99.js (unpacked official app).
// Offsets are byte offsets into that chunk.

// ---- terrain emissive (totalEmissiveRadiance = texelColor.rgb * radiance) @417408 ----
 grass sprites. Ideally share a chunk?

totalEmissiveRadiance = texelColor.rgb * radiance;

//// FINAL COMPOSITION

diffuseColor *= texelColor;

// DEBUG COLOURS
// diffuseColor = vec4(vHeather, vCurvature, 0.0, 1.0);
// diffuseColor.rgb = vNormal.rgb;
// diffuseColor = vec4(vec3(vLightGrass), 1.0);

// Clamp to reduce glittering pixels? Needs a better fix though... this is a last resort


`,mu=`

    float fresnel = 1.0 - max( 0.0, dot( normalize(cameraPosition - vFresnelPos), vFresnelNorm ) );

    float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0 * (1.0 - blendVal * 0.5);
    lightFresnel *= lightFresnel;
    lightFresnel *= (1.0 - vShadow);
    lightFresnel *= fresnelIntensity;
    


// ---- grass sprite emissive (must match the ground) @459956 ----
 the ground. Ideally share a chunk?
    totalEmissiveRadiance = texelColor.rgb * radiance;


`,Zu=`

    float fresnel = 1.0 - max( 0.0, dot( normalize(cameraPosition - vFresnelPos), vFresnelNorm ) );

    float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0 * clamp((vUv.y * 3.0), 0.7, 0.9); // Bias fresnel brightness

// ---- bush emissive (radiance * vAO) @466079 ----
xelColor;

    //// PREP EMISSIVE?

    totalEmissiveRadiance = texelColor.rgb * radiance * vAO;//texelColor.rgb * 2.0; // * (1.0 - vLightGrass * 0.8);

`,fn=`
    attribute float shadow;
    varying float vShadow;
	uniform float shadowFactor;
`,pn=`
    vShad

// ---- road emissive @482394 ----
if it's done on paint lines
            totalEmissiveRadiance = texelColor.rgb * radiance;

            //// PAINT

            if(hasPaint) {

                vec4 paintCol = texture( dashedMap, vMapUv, -0.3 );

                float wSolid = smoothstep(0.49, 0.51, vSolid);

                float wSolidLeft = smoothst

// ---- tree card leaf glow emissive @428626 ----
.0 - discolouration) * leafEffect;

    totalEmissiveRadiance = vec3(diffuseColor.rg * 8.0, 0.5) * radiance * leafEffect * vRadianceBlend;
    diffuseColor.rgb *= vRadianceBlend;

`,Ru=`
    if(diffuseColor.a < vAlphaTest) discard;
`,Cu=`

    // Use the normal to blend with snow colours

    // ONLY DO THIS ON SNOW VIBES
    if(hasSnow) {
        float dotUp = dot(normal, vCameraUp );
        if(dotUp > 0.1) {
     

// ---- lights_fragment_begin_shadow (ambient vShadow modulation) @472292 ----
I_LIGHTS; i ++ ) {

			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry.normal );

		}
		#pragma unroll_loop_end

	#endif

	//// SHADOW EFFECT ON AMBIENT
	
	irradiance *= 1.75 - min(1.0, max(0.75, vShadow));

	////

#endif

#if defined( RE_IndirectSpecular )

	vec3 radianc

// ---- terrain per-season uniforms (radiance = lights.radiance) @504969 ----
i.ground.fieldDiscolouration),F.userData.radiance.value=i.lights.radiance??0,F.displacementMap=F.userData.rockMapBump.value,F.userData.roadCol.value=xi(i.colours.road),F.userData.fresnelIntensity.value=i.lights.fresnelFactor??1,ge.map=U(i.maps.grassSprites,4,pt),Re.map=U(i.maps.bushes,2,pt);let e=ms?i.maps.roadSingle:i.maps.road,s=!!e.paintDashed;Y.userData.hasPaint.value=s,Y.map=U(e.base,s?4:16),Y.userData.dashedMap.value=s?U(e.paintDashed,16):void 0,Y.us

// ---- tree card radiance = lights.radiance / 2 @505838 ----
ata.textureStretch.value=e.stretch??1,oe.radiance.value=i.lights.radiance?i.lights.radiance/2:0,oe.discolourationFactor.value=i.effects.treeDiscolouration?i.effects.treeDiscolouration:1,oe.hasSnow.value=!!i.effects.hasSnow,ae.map=U(i.maps.imposterMap,0,pt),ae.userData.mapB.value=U(i.maps.imposterMap

// ---- grass material chain (Lambert + composition patch) @520276 ----
alEmissiveRadiance;")};let ff=.25;const ge=new K({map:de,alphaTest:ff,side:Lt});ge.needsCameraPosition=!0;ge.userData.noiseMap={value:Ui};ge.userData.sproutNear={value:100*100};ge.userData.sproutFar={value:200*200};ge.userData.vehiclePos={value:new m};ge.userData.flatten={value:!1};ge.customProgramCacheKey=()=>"grass";ge.onBeforeCompile=l=>{l.uniforms.noiseMap=ge.userData.noiseMap,l.uniforms.sproutNear=ge.userData.sproutNear,l.uniforms.sproutFar=ge.userData.sproutFar,l.uniforms.vehiclePos=ge.userData.vehiclePos,l.uniforms.flatten=ge.userData.flatten,l.uniforms.grassColA=F.userData.grassColA,l.uniforms.grassColB=F.userData.grassColB,l.uniforms.peakColA=F.userData.peakColA,l.uniforms.peakColB=F.userData.peakColB,l.uniforms.grassVariationMap=F.userData.grassVariationMap,l.uniforms.detailFarMap=F.userData.detailFarMap,l.uniforms.fresnelIntensity=F.userData.fresnelIntensity,l.uniforms.radianc

// ---- terrain material constructor (map/displacementMap/fog) @508192 ----
Data.sinkDist.value=l.lod0Horizon}const F=new K({map:U(Wt),displacementMap:U(Wt),fog:!0});F.needsCameraPosition=!0;F.userData.grassMap={value:null};F.userData.sandMap={value:null};F.userData.rockMap={value:null};F.userData.rockMapBump={value:null};F.userData.gravelMap={value:null};F.userData.heatherMap={value:null};F.userData.forestMap={v

// ---- renderer + lights (from chunks__SettingsManager.a31845d6.js / nodes__3.da2ad8c8.js) ----
// renderer = new WebGLRenderer({antialias:true, powerPreference:"high-performance", stencil:false, logarithmicDepthBuffer:false})
// renderer.setClearColor(0x444444); renderer.toneMapping = CineonToneMapping; renderer.shadowMap.enabled = true; useLegacyLights = false
// sunLight = new DirectionalLight(0xffffff, 2.5); ambLight = new AmbientLight(0xffffff, 1); hemiLight = new HemisphereLight(0xffffff, 0, 1)
// updateSky(): sunLight.intensity = preset.sun.intensity; sunLight.color = preset.sun.col;
//   ambLight.intensity = preset.ambient.intensity; ambLight.color = preset.ambient.col;
//   hemiLight.intensity = preset.ambient.intensity; hemiLight.color = preset.sun.col; hemiLight.groundColor = 0x000000
// sunLight.target = vehicle; sunLight.position = vehicle.position + (0,10,0)  => direction (0,-1,0)
// sunLight.castShadow = true; shadow.radius = 5; shadow.camera.near = 0.5; far = 50; left/right/top/bottom = ±shadowMapSize
// composition patch: outgoingLight = direct + indirect + direct * totalEmissiveRadiance

// ---- fog uniform color space (official three build, chunks__conifers.26f84295.js) ----
// 官方 three 构建被改过：UniformsLib.fog 里直接带 fogColorA/B/C/hazeHeight/hazeIntensity，
// 且 refreshFogUniforms（内部函数 n(m,f)）把雾色换算到**渲染输出色空间**再推入：
//
//   function Bs(i){ return i.getRenderTarget()===null ? i.outputColorSpace : $t }   // $t = ColorManagement.workingColorSpace
//   function n(m,f){
//     f.colorA.getRGB(m.fogColorA.value, Bs(i)), f.colorB.getRGB(m.fogColorB.value, Bs(i)),
//     f.colorC.getRGB(m.fogColorC.value, Bs(i)),
//     m.fogNear.value=f.near, m.fogFar.value=f.far,
//     m.hazeHeight.value=f.hazeHeight, m.hazeIntensity.value=f.hazeIntensity,
//     f.isFogExp2 && (m.fogDensity.value=f.density)
//   }
//
// 原因是 three 的片元顺序是 opaque_fragment → tonemapping_fragment → colorspace_fragment →
// fog_fragment：官方自定义的 fog chunk（sr_fog_ou.glsl）在 **显示空间** 混色，所以
// fogColorA/B/C 必须是输出色空间分量（渲染到画布 = 预设 hex 的 sRGB 分量）。
// 官方自定义雾类（同一构建内）：
//   class FogExp2 { constructor(colorA,colorB,colorC,near=1,far=1000,density=25e-5,hazeHeight=0,hazeIntensity=0)
//                   { this.colorA=new Color(e); this.colorB=new Color(t); this.colorC=new Color(n); ... } }
//   class Fog     { constructor(colorA,colorB,colorC,near=1,far=1000,hazeHeight=0,hazeIntensity=0) { ... } }
// scene.fog = new FogExp2(colA,colB,colC, near, far, density)   // 由 updateSky() 按预设下发
// updateSky(): this.sky.position.z = -n1 + 0.1;  // n1 = graphicsPreset.tileSize * 2
//              fogNear = n1 * preset.fog.near; fogFar = n1 * preset.fog.far; fogDensity = sqrt(5)/fogFar

