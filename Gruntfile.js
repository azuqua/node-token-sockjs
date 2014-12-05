module.exports = function (grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json"),

    jshint: {
      files: [ 
        "Gruntfile.js",
        "lib/**/*.js",
        "test/**/*.js"
      ],
      options: {}
    },

    mochaTest: {
      options: { reporter: 'spec', checkLeaks: true },
      src: ["test/index.js"]
    }

  });

  grunt.loadNpmTasks("grunt-contrib-clean");
  grunt.loadNpmTasks("grunt-contrib-jshint");
  grunt.loadNpmTasks("grunt-mocha-test");

  grunt.registerTask("lint", [ "jshint" ]);
  grunt.registerTask("test", [ "mochaTest"]);
  grunt.registerTask("default", [ "lint", "test" ]);

};