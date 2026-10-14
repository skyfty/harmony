

    vec4 c1 = texture2D(map, vUUv);
    vec4 c2 = texture2D(map, vUUUv);
    vec4 c3 = texture2D(map, vUUUUv);

    c1.a = remap(c1.a, 0.0, 1.0, 0.5, 1.0);
    c1.a = max(c1.a, 0.0);
    c2.a = remap(c2.a, 0.0, 1.0, 0.5, 1.0);
    c2.a = max(c2.a, 0.0);

    // c2.a -= c3.a * 0.25;
    float ic1 = 1.0 - c1.a;
    float ic2 = 1.0 - c2.a;
    float ic = 1.0 - ic1 * ic2;

    ic *= c1.a * c2.a;

    gl_FragColor.rgb = mix(gl_FragColor.rgb, highlight, ic * dist);


    // diffuseColor = vec4(0.5,0.6,0.8,);


